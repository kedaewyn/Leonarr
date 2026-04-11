import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { t } from '../i18n.js';
import { getLink } from '../store.js';
import * as oscarr from '../lib/oscarr.js';
import { mediaCardEmbed, seasonPickerEmbed } from '../lib/embeds.js';

// In-memory session store.
const sessions = new Map();
const SESSION_TTL_MS = 10 * 60 * 1000;
// Background cleanup — without it, expired sessions linger until the next
// /search invocation, which means orphaned sessions hold TMDB payloads in
// memory for up to SESSION_TTL_MS regardless of user activity.
const CLEANUP_INTERVAL_MS = 2 * 60 * 1000;
const TMDB_GENRE_ANIMATION = 16;
const SELECT_MENU_MAX = 25;
const MAX_SEASON_OPTIONS = SELECT_MENU_MAX - 1;

function cleanupSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.expiresAt < now) sessions.delete(id);
  }
}

let cleanupTimer = null;

/** Start the background session GC. Safe to call multiple times. */
export function startCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanupSessions, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
}

/** Stop the GC and drop all sessions — called on bot shutdown / restart. */
export function stopCleanupTimer() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  sessions.clear();
}

function categoryLabel(category, lang) {
  if (!category) return '';
  if (category.isRule) {
    return `${category.ruleName} (${t(lang, 'search.cat.rule_tag')})`;
  }
  return t(lang, category.labelKey);
}

function filterResultsByCategory(results, category) {
  if (!category) return results.filter((r) => r.media_type === 'movie' || r.media_type === 'tv');

  const base = results.filter((r) => r.media_type === category.mediaType);

  if (category.mediaType === 'tv' && category.seriesType === 'anime') {
    return base.filter(
      (r) =>
        Array.isArray(r.genre_ids)
        && r.genre_ids.includes(TMDB_GENRE_ANIMATION)
        && Array.isArray(r.origin_country)
        && r.origin_country.includes('JP'),
    );
  }

  return base;
}


function browseRow(sessionId, idx, total, lang, current) {
  const oscarrStatus = current.oscarrStatus || null;
  const isAvailable = oscarrStatus?.status === 'available';
  const hasActiveRequest = oscarrStatus?.userHasActiveRequest === true;
  const disableRequest = isAvailable || hasActiveRequest;

  let requestLabel;
  if (isAvailable) {
    requestLabel = t(lang, 'search.button_already_available');
  } else if (hasActiveRequest) {
    requestLabel = t(lang, 'search.button_already_requested');
  } else {
    requestLabel = t(
      lang,
      current.media_type === 'tv' ? 'search.button_request_tv' : 'search.button_request'
    );
  }

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`leonarr:search:prev:${sessionId}`)
      .setLabel(t(lang, 'search.button_prev'))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(idx === 0),

    new ButtonBuilder()
      .setCustomId(`leonarr:search:request:${sessionId}`)
      .setLabel(requestLabel)
      .setStyle(disableRequest ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(disableRequest),

    new ButtonBuilder()
      .setCustomId(`leonarr:search:next:${sessionId}`)
      .setLabel(t(lang, 'search.button_next'))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(idx >= total - 1)
  );
}

function buildBrowseView(session, lang) {
  const current = session.results[session.idx];
  const embed = mediaCardEmbed(current, lang)
    .setAuthor({ name: categoryLabel(session.category, lang) })
    .setFooter({
      text: t(lang, 'search.result_count', { current: session.idx + 1, total: session.results.length }),
    });
  return {
    embeds: [embed],
    components: [browseRow(session.id, session.idx, session.results.length, lang, current)],
  };
}


function buildPickerView(session, media, seasons, lang) {
  const embed = seasonPickerEmbed(media, seasons.length, lang);

  const select = new StringSelectMenuBuilder()
    .setCustomId(`leonarr:search:seasons:${session.id}`)
    .setPlaceholder(t(lang, 'search.season_placeholder'))
    .setMinValues(1);

  const options = [
    new StringSelectMenuOptionBuilder()
      .setLabel(t(lang, 'search.season_all'))
      .setDescription(t(lang, 'search.season_all_desc'))
      .setValue('all')
      .setEmoji('🎞️'),
  ];

  const visible = seasons.slice(0, MAX_SEASON_OPTIONS);
  for (const s of visible) {
    const label = t(lang, 'search.season_option', { n: s.season_number });
    const year = s.air_date ? s.air_date.slice(0, 4) : '';
    const description = year
      ? t(lang, 'search.season_option_desc_year', { count: s.episode_count, year })
      : t(lang, 'search.season_option_desc', { count: s.episode_count });
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(label)
        .setDescription(description.slice(0, 100)) // Discord caps description at 100 chars
        .setValue(String(s.season_number))
    );
  }

  select
    .addOptions(options)
    .setMaxValues(options.length);

  const row1 = new ActionRowBuilder().addComponents(select);
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`leonarr:search:back:${session.id}`)
      .setLabel(t(lang, 'search.season_back'))
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embeds: [embed],
    components: [row1, row2],
  };
}


function formatSeasonsForMessage(seasons, lang) {
  if (!seasons || seasons.length === 0) return t(lang, 'request.all_seasons');
  const sorted = [...seasons]
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  return sorted.map((n) => `S${String(n).padStart(2, '0')}`).join(', ');
}

/**
 * Build the user-facing reply message from a `createRequest` result.
 *
 * This used to live inline in two different code paths (movie via
 * `request` button, TV via select menu submission) which drifted apart.
 * Now both paths route through here.
 *
 * @param {{ ok: boolean, code?: string, error?: string, title?: string, autoApproved?: boolean }} result
 * @param {'fr'|'en'} lang
 * @param {object} media      TMDB search result (for duplicate fallback title)
 * @param {number[] | undefined} seasons   `undefined` for movies or "all seasons"
 * @returns {string}
 */
function buildRequestResultMessage(result, lang, media, seasons) {
  if (result.ok) {
    // TV with specific seasons gets the richer "Breaking Bad — S01, S03" format
    const withSeasons = media.media_type === 'tv' && seasons != null && seasons.length > 0;
    if (withSeasons) {
      const seasonsLabel = formatSeasonsForMessage(seasons, lang);
      return result.autoApproved
        ? t(lang, 'request.auto_approved_seasons', { title: result.title, seasons: seasonsLabel })
        : t(lang, 'request.success_seasons', { title: result.title, seasons: seasonsLabel });
    }
    return result.autoApproved
      ? t(lang, 'request.auto_approved', { title: result.title })
      : t(lang, 'request.success', { title: result.title });
  }

  const errorMessages = {
    DUPLICATE: t(lang, 'request.duplicate', { title: media.title || media.name }),
    BLACKLIST: t(lang, 'request.blacklisted'),
    GUARD: result.error,
    INVALID: t(lang, 'request.failed', { error: result.error }),
    SEND_FAILED: t(lang, 'request.failed', { error: result.error }),
  };
  return errorMessages[result.code] || t(lang, 'request.failed', { error: result.error });
}


export async function handleSearchAutocomplete(interaction, { ctx, lang }) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'type') {
    await interaction.respond([]);
    return;
  }

  const partial = (focused.value || '').toString().trim().toLowerCase();
  const categories = await oscarr.listSearchCategories({ log: ctx.log });

  const choices = categories
    .map((c) => ({
      name: categoryLabel(c, lang),
      value: c.id,
    }))
    .filter((c) => !partial || c.name.toLowerCase().includes(partial))
    .slice(0, SELECT_MENU_MAX);

  await interaction.respond(choices);
}

export async function handleSearch(interaction, { ctx, lang, requireLogin }) {
  const query = interaction.options.getString('query', true);
  const typeId = interaction.options.getString('type', true);

  const link = await getLink(ctx, interaction.user.id);
  if (requireLogin && !link) {
    await interaction.reply({ content: t(lang, 'login.not_linked'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const category = await oscarr.resolveCategoryById(typeId);
  if (!category) {
    await interaction.editReply(t(lang, 'error.generic', { error: 'unknown category' }));
    return;
  }
  const catLabel = categoryLabel(category, lang);

  let results;
  try {
    results = await oscarr.searchMulti(query, lang);
  } catch (err) {
    ctx.log.error(`[Leonarr] Search failed: ${err}`);
    await interaction.editReply(t(lang, 'error.generic', { error: 'TMDB search failed' }));
    return;
  }

  const filtered = filterResultsByCategory(results, category);

  if (filtered.length === 0) {
    await interaction.editReply(t(lang, 'search.no_match_in_type', { label: catLabel, query }));
    return;
  }

  // Enrich each result with its current Oscarr status (available / processing
  // / user's own pending request). Best-effort — if it fails, batchStatus
  // logs the warning internally and returns an empty object.
  const statusMap = await oscarr.batchStatus(
    filtered.map((r) => ({ tmdbId: r.id, mediaType: r.media_type })),
    link?.oscarrUserId ?? null,
    { log: ctx.log },
  );
  for (const r of filtered) {
    const key = `${r.media_type}:${r.id}`;
    r.oscarrStatus = statusMap[key] || null;
  }

  cleanupSessions();
  const sessionId = interaction.id;
  const session = {
    id: sessionId,
    results: filtered,
    idx: 0,
    userId: interaction.user.id,
    category,
    pickerSeasons: null,  // populated when entering the season picker
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessions.set(sessionId, session);

  await interaction.editReply(buildBrowseView(session, lang));
}


async function requireSession(interaction, sessionId, lang) {
  const session = sessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) {
    await interaction.reply({ content: t(lang, 'search.expired'), flags: MessageFlags.Ephemeral });
    sessions.delete(sessionId);
    return null;
  }
  if (interaction.user.id !== session.userId) {
    await interaction.reply({
      content: t(lang, 'search.not_yours'),
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }
  return session;
}


async function enterSeasonPicker(interaction, session, ctx, lang) {
  const current = session.results[session.idx];

  let details;
  try {
    details = await oscarr.getTvDetails(current.id, lang);
  } catch (err) {
    ctx.log.error(`[Leonarr] getTvDetails failed for ${current.id}: ${err}`);
    await interaction.reply({
      content: t(lang, 'search.season_details_failed'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const seasons = (details?.seasons || []).filter((s) => s.season_number > 0);
  if (seasons.length === 0) {
    // Fallback: no selectable seasons — just request the whole thing.
    await interaction.reply({
      content: t(lang, 'search.season_none_selectable'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  session.pickerSeasons = seasons;
  await interaction.update(buildPickerView(session, current, seasons, lang));
}


/**
 * Create a request and report the result on the same ephemeral message.
 *
 * Shared between the TV season picker (via `interaction.update`) and the
 * movie quick-request path (via `interaction.editReply` after a defer).
 *
 * @param {object}  interaction   Discord.js interaction (button or select)
 * @param {object}  session       Search session
 * @param {object}  ctx           Oscarr plugin ctx
 * @param {string}  lang
 * @param {number[] | undefined}  selectedSeasons   undefined = all, array = specific seasons
 * @param {'update' | 'editReply'} replyMode
 *   - `update`: collapse the existing component message into a terminal reply (select menu path)
 *   - `editReply`: write into a pre-deferred ephemeral reply (button-request path)
 */
async function submitRequest(interaction, session, ctx, lang, selectedSeasons, replyMode) {
  const current = session.results[session.idx];

  const terminal = (content) => {
    if (replyMode === 'update') {
      return interaction.update({ content, embeds: [], components: [] });
    }
    return interaction.editReply(content);
  };

  const link = await getLink(ctx, interaction.user.id);
  if (!link) {
    await terminal(t(lang, 'login.not_linked'));
    return;
  }

  const user = await oscarr.getUserWithRole(link.oscarrUserId);
  if (!user) {
    await terminal(t(lang, 'error.generic', { error: 'User not found' }));
    return;
  }

  const result = await oscarr.createRequest(user, current.id, current.media_type, selectedSeasons);
  const message = buildRequestResultMessage(result, lang, current, selectedSeasons);
  await terminal(message);
}


export async function handleSearchButton(interaction, { ctx, lang }) {
  const parts = interaction.customId.split(':');
  const action = parts[2];
  const sessionId = parts[3];

  const session = await requireSession(interaction, sessionId, lang);
  if (!session) return;

  if (action === 'prev' || action === 'next') {
    session.idx += action === 'next' ? 1 : -1;
    session.idx = Math.max(0, Math.min(session.results.length - 1, session.idx));
    await interaction.update(buildBrowseView(session, lang));
    return;
  }

  if (action === 'back') {
    // Restore the browse view from the current idx
    session.pickerSeasons = null;
    await interaction.update(buildBrowseView(session, lang));
    return;
  }

  if (action === 'request') {
    const current = session.results[session.idx];

    // Defensive guard — the button is rendered disabled in these cases,
    // but a stale message could still receive clicks.
    const status = current.oscarrStatus;
    if (status?.userHasActiveRequest) {
      await interaction.reply({
        content: t(lang, 'search.status.pending_user', {
          status: status.userRequestStatus || 'pending',
        }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (status?.status === 'available') {
      await interaction.reply({
        content: t(lang, 'search.status.available'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (current.media_type === 'movie') {
      // Defer first because createRequest can take a moment, then delegate
      // to the shared submitRequest helper in editReply mode.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await submitRequest(interaction, session, ctx, lang, undefined, 'editReply');
      return;
    }

    // TV → transition to the season picker
    await enterSeasonPicker(interaction, session, ctx, lang);
  }
}


export async function handleSearchSelect(interaction, { ctx, lang }) {
  const parts = interaction.customId.split(':');
  const action = parts[2];
  const sessionId = parts[3];

  const session = await requireSession(interaction, sessionId, lang);
  if (!session) return;

  if (action === 'seasons') {
    const values = interaction.values || [];
    // "all" is a shortcut — treat as undefined (monitor everything Sonarr-side)
    const selectedSeasons = values.includes('all')
      ? undefined
      : values.map((v) => parseInt(v, 10)).filter((n) => Number.isFinite(n) && n > 0);
    await submitRequest(interaction, session, ctx, lang, selectedSeasons, 'update');
  }
}
