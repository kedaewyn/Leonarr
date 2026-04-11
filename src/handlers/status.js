import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { t } from '../i18n.js';
import { getLink } from '../store.js';
import * as oscarr from '../lib/oscarr.js';
import { statusEmbed, classifyRequest } from '../lib/embeds.js';

// Statuses where it's worth hitting the *arr queue endpoints for live progress.
const ACTIVE_DOWNLOAD_STATUSES = new Set(['approved', 'processing', 'searching', 'upcoming']);

// sessionId → { userId, requests, progressMap, counts, filter, expiresAt }
const sessions = new Map();
const SESSION_TTL_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 2 * 60 * 1000;

const FILTERS = ['all', 'downloading', 'waiting', 'available'];

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

function bucketCounts(requests, progressMap) {
  const counts = { all: requests.length, downloading: 0, waiting: 0, available: 0 };
  for (const r of requests) {
    const bucket = classifyRequest(r, progressMap);
    counts[bucket] += 1;
  }
  return counts;
}

function filterRequests(requests, progressMap, filter) {
  if (filter === 'all') return requests;
  return requests.filter((r) => classifyRequest(r, progressMap) === filter);
}

function buildFilterRow(session, lang) {
  const row = new ActionRowBuilder();
  const styles = {
    all: session.filter === 'all' ? ButtonStyle.Primary : ButtonStyle.Secondary,
    downloading: session.filter === 'downloading' ? ButtonStyle.Primary : ButtonStyle.Secondary,
    waiting: session.filter === 'waiting' ? ButtonStyle.Primary : ButtonStyle.Secondary,
    available: session.filter === 'available' ? ButtonStyle.Primary : ButtonStyle.Secondary,
  };

  for (const filter of FILTERS) {
    const count = session.counts[filter];
    const baseLabel = t(lang, `status.button_${filter}`);
    const label = count > 0 || filter === 'all' ? `${baseLabel} (${count})` : baseLabel;

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`leonarr:status:filter:${session.id}:${filter}`)
        .setLabel(label)
        .setStyle(styles[filter])
        .setDisabled(filter !== 'all' && count === 0)
    );
  }

  return row;
}

function buildRefreshRow(session, lang) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`leonarr:status:refresh:${session.id}`)
      .setLabel(t(lang, 'status.button_refresh'))
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildView(session, lang) {
  const filtered = filterRequests(session.requests, session.progressMap, session.filter);
  const embed = statusEmbed(filtered, lang, {
    progressMap: session.progressMap,
    filter: session.filter,
  });
  return {
    embeds: [embed],
    components: [buildFilterRow(session, lang), buildRefreshRow(session, lang)],
  };
}

async function refreshSession(session, ctx) {
  const requests = await oscarr.listUserRequests(session.oscarrUserId, 10);
  let progressMap = new Map();
  const activeMedias = requests
    .filter((r) => ACTIVE_DOWNLOAD_STATUSES.has(r.status))
    .map((r) => r.media);
  if (activeMedias.length > 0) {
    try {
      progressMap = await oscarr.getDownloadProgress(activeMedias, { log: ctx.log });
    } catch (err) {
      ctx.log.warn(`[Leonarr] /status refresh: getDownloadProgress failed: ${err}`);
    }
  }
  session.requests = requests;
  session.progressMap = progressMap;
  session.counts = bucketCounts(requests, progressMap);
  session.expiresAt = Date.now() + SESSION_TTL_MS;
}


export async function handleStatus(interaction, { ctx, lang }) {
  const link = await getLink(ctx, interaction.user.id);
  if (!link) {
    await interaction.reply({ content: t(lang, 'login.not_linked'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let requests;
  try {
    requests = await oscarr.listUserRequests(link.oscarrUserId, 10);
  } catch (err) {
    ctx.log.error(`[Leonarr] Failed to list requests: ${err}`);
    await interaction.editReply(t(lang, 'error.generic', { error: 'DB query failed' }));
    return;
  }

  // Enrich active requests with live queue progress. Best-effort.
  let progressMap = new Map();
  const activeMedias = requests
    .filter((r) => ACTIVE_DOWNLOAD_STATUSES.has(r.status))
    .map((r) => r.media);
  if (activeMedias.length > 0) {
    try {
      progressMap = await oscarr.getDownloadProgress(activeMedias, { log: ctx.log });
      ctx.log.info(
        `[Leonarr] /status: ${progressMap.size}/${activeMedias.length} active request(s) have live progress`
      );
    } catch (err) {
      ctx.log.warn(`[Leonarr] getDownloadProgress failed: ${err}`);
    }
  }

  cleanupSessions();
  const sessionId = interaction.id;
  const session = {
    id: sessionId,
    userId: interaction.user.id,
    oscarrUserId: link.oscarrUserId,
    requests,
    progressMap,
    counts: bucketCounts(requests, progressMap),
    filter: 'all',
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessions.set(sessionId, session);

  await interaction.editReply(buildView(session, lang));
}

export async function handleStatusButton(interaction, { ctx, lang }) {
  const parts = interaction.customId.split(':');
  const action = parts[2];
  const sessionId = parts[3];

  const session = sessions.get(sessionId);
  if (!session || session.expiresAt < Date.now()) {
    await interaction.reply({
      content: t(lang, 'search.expired'),
      flags: MessageFlags.Ephemeral,
    });
    sessions.delete(sessionId);
    return;
  }

  if (interaction.user.id !== session.userId) {
    await interaction.reply({
      content: t(lang, 'search.not_yours'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'filter') {
    const newFilter = parts[4];
    if (!FILTERS.includes(newFilter)) return;
    session.filter = newFilter;
    await interaction.update(buildView(session, lang));
    return;
  }

  if (action === 'refresh') {
    // Defer the update — queue polling can take a second or two.
    await interaction.deferUpdate();
    try {
      await refreshSession(session, ctx);
    } catch (err) {
      ctx.log.warn(`[Leonarr] /status refresh failed: ${err}`);
    }
    // If the active filter is now empty after refresh (e.g. all downloads
    // finished), fall back to "all" so the view stays useful.
    if (session.filter !== 'all' && session.counts[session.filter] === 0) {
      session.filter = 'all';
    }
    await interaction.editReply(buildView(session, lang));
    return;
  }
}
