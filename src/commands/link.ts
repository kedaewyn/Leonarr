import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { createI18n, resolveInstanceLanguage, type TFn } from '../i18n/index.js';
import type { Ctx } from '../types.js';

/** `/link` — Discord account ↔ Oscarr account pairing.
 *
 *  Plug-and-play UX: we point the user at Oscarr's canonical authorize endpoint with
 *  `?action=link`. From there:
 *    1. If the user is already logged in to Oscarr (web cookie present) → straight through
 *       to Discord OAuth → callback links the identities.
 *    2. If the user is logged out → Oscarr's authorize handler 302s to
 *       `/login?next=<this URL>`; the LoginPage honours `next` and bounces back here after
 *       a successful login, so the link completes without the user having to remember to
 *       re-click anything.
 *
 *  No state HMAC on our side: Oscarr's authorize handler generates its own UUID `state`
 *  stored server-side (providers/discord/index.ts), so a plugin-side HMAC would be dead
 *  weight. The flow's authenticity is anchored on Oscarr's session cookie, which is the
 *  right primitive — we can't outdo that from a Discord bot. */
export function buildCommand(t: TFn): RESTPostAPIChatInputApplicationCommandsJSONBody {
  return new SlashCommandBuilder()
    .setName(t('cmd.link.name'))
    .setDescription(t('cmd.link.description'))
    .toJSON();
}

export async function handle(interaction: ChatInputCommandInteraction, ctx: Ctx): Promise<void> {
  const lang = await resolveInstanceLanguage(ctx);
  const t = createI18n(lang);

  // Already linked → polite early-out. The OAuth flow on Oscarr's side would also notice
  // (upsert by providerId), but skipping the full round-trip is cleaner UX.
  const existing = await ctx.findUserByProvider('discord', interaction.user.id);
  if (existing) {
    await interaction.reply({
      content: t('link.already', { name: existing.displayName || existing.email }),
      ephemeral: true,
    });
    return;
  }

  // siteUrl is the canonical outbound base (same source email / push notifications use).
  // If unset, the user sees a broken link — the admin's misconfiguration to fix, not ours
  // to paper over.
  const appSettings = await ctx.getAppSettings();
  const rawBase = typeof appSettings.siteUrl === 'string' ? appSettings.siteUrl : '';
  const base = rawBase.replace(/\/$/, '');
  if (!base) {
    ctx.log.warn({ discordId: interaction.user.id }, 'AppSettings.siteUrl not configured — /link cannot build a deep link');
    await interaction.reply({ content: t('link.misconfigured'), ephemeral: true });
    return;
  }
  const authorizeUrl = `${base}/api/auth/discord/authorize?action=link`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setLabel(t('link.button')).setStyle(ButtonStyle.Link).setURL(authorizeUrl),
  );

  await interaction.reply({
    content: t('link.prompt'),
    components: [row],
    ephemeral: true,
  });
}
