import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { createI18n, resolveInstanceLanguage, type TFn } from '../i18n/index.js';
import type { Ctx } from '../types.js';

/** `/search <query>` — TMDB autocomplete + one-click request submission.
 *
 *  Autocomplete path: ctx.tmdb.search(query) → top 10 movie/tv rows, encoded as
 *  `value = "<mediaType>:<tmdbId>"` so the submit path can parse without a second lookup.
 *
 *  Submit path: parse the selected value → ctx.tmdb.movie/tv for the display embed →
 *  ephemeral reply with a "Request" button. Click → ctx.requests.create as the linked
 *  Oscarr user. All failure codes from the unified pipeline map to localized strings so
 *  Discord users see the same reason an Oscarr web user would see.
 */

const MAX_RESULTS = 10;
const ENCODED_PATTERN = /^(movie|tv):(\d+)$/;

// Hardcoded slug — see comment in commands/link.ts. Dispatch keys against this literal.
export function buildCommand(t: TFn): RESTPostAPIChatInputApplicationCommandsJSONBody {
  return new SlashCommandBuilder()
    .setName('search')
    .setDescription(t('cmd.search.description'))
    .addStringOption((opt) => opt
      .setName('query')
      .setDescription(t('cmd.search.query'))
      .setRequired(true)
      .setAutocomplete(true),
    )
    .toJSON();
}

// ─── Autocomplete ────────────────────────────────────────────────────

export async function handleAutocomplete(
  interaction: AutocompleteInteraction,
  ctx: Ctx,
): Promise<void> {
  const query = interaction.options.getString('query', false) ?? '';
  if (query.trim().length < 2) {
    await interaction.respond([]);
    return;
  }
  const lang = await resolveInstanceLanguage(ctx);
  try {
    const page = await ctx.tmdb.search(query, { lang });
    const rows = (page.results || [])
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .slice(0, MAX_RESULTS)
      .map((r) => {
        const title = (r.title || r.name || 'Untitled') as string;
        const year = ((r.release_date || r.first_air_date || '') as string).slice(0, 4);
        const kind = r.media_type === 'movie' ? '🎬' : '📺';
        const label = year ? `${kind} ${title} (${year})` : `${kind} ${title}`;
        return {
          // Discord caps autocomplete `name` at 100 chars.
          name: label.length > 100 ? `${label.slice(0, 97)}...` : label,
          value: `${r.media_type}:${r.id}`,
        };
      });
    await interaction.respond(rows);
  } catch (err) {
    ctx.log.warn({ err, query }, 'TMDB autocomplete failed');
    await interaction.respond([]);
  }
}

// ─── Slash submit (shows the preview card) ───────────────────────────

export async function handle(
  interaction: ChatInputCommandInteraction,
  ctx: Ctx,
): Promise<void> {
  const lang = await resolveInstanceLanguage(ctx);
  const t = createI18n(lang);

  const user = await ctx.findUserByProvider('discord', interaction.user.id);
  if (!user) {
    await interaction.reply({ content: t('not_linked'), ephemeral: true });
    return;
  }

  const raw = interaction.options.getString('query', true);
  // Autocomplete sends back our encoded value. A user who typed a plain string instead
  // (never picked a suggestion) gets a "no result" reply — we don't do a text → search here
  // because the UX would be a guessing game; point them at autocomplete.
  const parsed = raw.match(ENCODED_PATTERN);
  if (!parsed) {
    await interaction.reply({ content: t('search.result.none', { query: raw }), ephemeral: true });
    return;
  }
  const mediaType = parsed[1] as 'movie' | 'tv';
  const tmdbId = Number(parsed[2]);

  await interaction.deferReply({ ephemeral: true });
  try {
    // Pull TMDB details + the user's Oscarr-side state for this title in parallel — they're
    // independent calls and either can be the latency floor of the reply. batchStatus gives
    // both the media's overall library status and *this user's* personal request state, so
    // we can branch the UX three ways below from one round-trip.
    const [details, statusMap] = await Promise.all([
      mediaType === 'movie'
        ? ctx.tmdb.movie(tmdbId, { lang })
        : ctx.tmdb.tv(tmdbId, { lang }),
      ctx.media.batchStatus([{ tmdbId, mediaType }], user.id),
    ]);
    const title = (('title' in details ? details.title : details.name) as string | undefined) || 'Untitled';
    const year = ((('release_date' in details ? details.release_date : details.first_air_date) as string | undefined) || '').slice(0, 4);
    const posterPath = details.poster_path;
    const overview = (details.overview as string | undefined) || '—';

    const state = statusMap[`${mediaType}:${tmdbId}`];
    const isAvailable = state?.status === 'available';
    const userHasRequest = state?.userHasActiveRequest === true;

    const embed = new EmbedBuilder()
      .setTitle(year ? `${title} (${year})` : title)
      .setDescription(overview.slice(0, 500))
      .setURL(`https://www.themoviedb.org/${mediaType}/${tmdbId}`);
    if (posterPath) embed.setThumbnail(`https://image.tmdb.org/t/p/w342${posterPath}`);

    // Three flavours of reply. We don't ship our own Dismiss/Cancel button because Discord
    // auto-renders a "Dismiss message" affordance on every ephemeral reply — adding our own
    // would just clutter the UI without doing anything Discord doesn't already do natively.
    //   - already requested by this user → no buttons (avoids redundant submit attempts hitting
    //     the DUPLICATE error code; user can check /status for live state).
    //   - already available in the library → no buttons.
    //   - default → only the Request button.
    let titleLine: string;
    const components: ActionRowBuilder<ButtonBuilder>[] = [];

    if (userHasRequest) {
      titleLine = t('search.submit.title.requested');
    } else if (isAvailable) {
      titleLine = t('search.submit.title.available');
    } else {
      titleLine = t('search.submit.title');
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`leonarr:submit:${mediaType}:${tmdbId}`)
            .setLabel(t('search.submit.confirm'))
            .setStyle(ButtonStyle.Primary),
        ),
      );
    }

    await interaction.editReply({ content: titleLine, embeds: [embed], components });
  } catch (err) {
    ctx.log.warn({ err, tmdbId, mediaType }, 'TMDB details fetch failed');
    await interaction.editReply({ content: t('request.error.generic', { code: 'TMDB_FETCH' }) });
  }
}

// ─── Button interactions (submit / cancel) ───────────────────────────

export async function handleSubmitButton(
  interaction: ButtonInteraction,
  ctx: Ctx,
): Promise<void> {
  const lang = await resolveInstanceLanguage(ctx);
  const t = createI18n(lang);

  const user = await ctx.findUserByProvider('discord', interaction.user.id);
  if (!user) {
    await interaction.update({ content: t('not_linked'), embeds: [], components: [] });
    return;
  }

  const parts = interaction.customId.split(':'); // ["leonarr","submit",<mt>,<id>]
  const mediaType = parts[2] as 'movie' | 'tv';
  const tmdbId = Number(parts[3]);

  await interaction.deferUpdate();
  // We don't need the embed anymore once the user clicked — but we DO need the title for
  // the confirmation reply. Pull from the embed instead of hitting TMDB again.
  const originalTitle = interaction.message.embeds?.[0]?.title || `${mediaType}:${tmdbId}`;

  const result = await ctx.requests.create({
    userId: user.id,
    tmdbId,
    mediaType,
  });

  let content: string;
  if (result.ok) {
    if (result.sendFailed) content = t('request.created.send_failed', { title: originalTitle });
    else if (result.autoApproved) content = t('request.created.approved', { title: originalTitle });
    else content = t('request.created.pending', { title: originalTitle });
  } else {
    switch (result.code) {
      case 'DUPLICATE': content = t('request.error.duplicate', { title: originalTitle }); break;
      case 'BLACKLISTED': content = t('request.error.blacklisted', { title: originalTitle }); break;
      case 'BLOCKED_BY_GUARD': content = t('request.error.blocked_by_guard', { reason: result.error }); break;
      case 'INVALID_INPUT': content = t('request.error.invalid', { reason: result.error }); break;
      case 'QUALITY_NOT_ALLOWED': content = t('request.error.quality'); break;
      default: content = t('request.error.generic', { code: result.code });
    }
  }

  await interaction.editReply({ content, embeds: [], components: [] });
}

