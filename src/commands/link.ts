import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import crypto from 'crypto';
import { createI18n, resolveInstanceLanguage, type TFn } from '../i18n/index.js';
import type { Ctx } from '../types.js';

/** `/link` — Discord account ↔ Oscarr account pairing.
 *
 *  We don't run any account creation ourselves: the admin enabled Oscarr's Discord OAuth
 *  provider (docs/auth-providers.md) and we just hand the user the canonical link-account
 *  URL. The `state` param is HMAC-signed with a plugin-scoped secret so Oscarr can verify
 *  the request came from *this* plugin (and not a malicious third party trying to associate
 *  their discord id with the victim's Oscarr session).
 *
 *  Expiry: 10 minutes, baked into the HMAC payload. Oscarr's /api/auth/discord/authorize
 *  handler can check `state.expires > Date.now()` to reject stale clicks.
 */
export function buildCommand(t: TFn): RESTPostAPIChatInputApplicationCommandsJSONBody {
  return new SlashCommandBuilder()
    .setName(t('cmd.link.name'))
    .setDescription(t('cmd.link.description'))
    .toJSON();
}

const STATE_TTL_MS = 10 * 60 * 1000;
const MIN_SECRET_LENGTH = 16;

function signState(secret: string, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export async function handle(interaction: ChatInputCommandInteraction, ctx: Ctx): Promise<void> {
  const lang = await resolveInstanceLanguage(ctx);
  const t = createI18n(lang);

  // If they're already linked, bail early — the OAuth flow on Oscarr's side would also
  // catch this, but a polite reply is clearer than sending them through a round-trip.
  const existing = await ctx.findUserByProvider('discord', interaction.user.id);
  if (existing) {
    await interaction.reply({
      content: t('link.already', { name: existing.displayName || existing.email }),
      ephemeral: true,
    });
    return;
  }

  const secret = await ctx.getSetting('oauthStateSecret');
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    ctx.log.warn({ discordId: interaction.user.id }, 'oauthStateSecret missing or too short — /link cannot sign state');
    await interaction.reply({ content: t('link.misconfigured'), ephemeral: true });
    return;
  }

  const state = signState(secret, {
    source: 'leonarr',
    discordId: interaction.user.id,
    expires: Date.now() + STATE_TTL_MS,
    nonce: crypto.randomBytes(8).toString('base64url'),
  });

  // We intentionally don't hardcode the Oscarr base URL — AppSettings.siteUrl is the
  // canonical one (used for every other outbound link like email / push notification
  // deep-links). If it's unset, the user sees a broken link — the admin's misconfiguration
  // to fix, not ours to paper over.
  const appSettings = await ctx.getAppSettings();
  const rawBase = typeof appSettings.siteUrl === 'string' ? appSettings.siteUrl : '';
  const base = rawBase.replace(/\/$/, '');
  const authorizeUrl = `${base}/api/auth/discord/authorize?action=link&state=${encodeURIComponent(state)}`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setLabel(t('link.button')).setStyle(ButtonStyle.Link).setURL(authorizeUrl),
  );

  await interaction.reply({
    content: t('link.prompt'),
    components: [row],
    ephemeral: true,
  });
}
