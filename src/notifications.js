/**
 * Background notification poller.
 *
 * Oscarr persists per-user notifications in the `UserNotification` table
 * whenever a requested media becomes available (see
 * `services/sync/helpers.ts` → `safeUserNotify`). We poll that table on a
 * cron schedule and DM any notification whose Oscarr userId matches a
 * Discord-linked user in the plugin settings.
 *
 * State is kept in the plugin settings blob under the `notifyState` key —
 * specifically a `lastNotifiedAt` ISO timestamp. On first run we initialize
 * it to "now" so we don't flood the user with historical notifications.
 */

import { EmbedBuilder } from 'discord.js';
import * as oscarr from './lib/oscarr.js';
import { posterUrl } from './lib/embeds.js';
import { sendDM, sendChannelMention } from './bot.js';
import { getLastChannel, withSettingsLock } from './store.js';
import { t } from './i18n.js';

const STATE_KEY = 'notifyState';
// Safety cap — never process more than this many notifications in a single tick
// to avoid runaway DMs if the plugin falls behind for a long time.
const MAX_PER_TICK = 50;
// Grace window applied to the watermark on every poll. We look a little
// further back than the last seen createdAt to catch out-of-order
// notifications (clock skew, replication lag). Dedup via processedIds
// prevents re-delivery.
const LOOKBACK_GRACE_MS = 60_000;
// Max number of notification ids we keep in the dedup set. Old ids are
// pruned FIFO once the cap is reached — chosen generous enough to cover
// the lookback window at any reasonable delivery rate.
const MAX_PROCESSED_IDS = 500;

/**
 * Read the persisted poll state. On first run, initialize `lastNotifiedAt`
 * to the current time so we don't retroactively DM notifications that
 * predated the plugin install.
 *
 * Shape: `{ lastNotifiedAt: iso string, processedIds: number[] }`
 */
async function readState(ctx) {
  const raw = await ctx.getSetting(STATE_KEY);
  if (!raw || typeof raw !== 'object' || !raw.lastNotifiedAt) {
    const fresh = {
      lastNotifiedAt: new Date().toISOString(),
      processedIds: [],
    };
    await withSettingsLock(() => ctx.setSetting(STATE_KEY, fresh));
    return fresh;
  }
  return {
    lastNotifiedAt: raw.lastNotifiedAt,
    processedIds: Array.isArray(raw.processedIds) ? raw.processedIds : [],
  };
}

async function writeState(ctx, state) {
  await withSettingsLock(() => ctx.setSetting(STATE_KEY, state));
}

/**
 * Read the Discord→Oscarr user link map once, build a reverse index from
 * `oscarrUserId` to `discordId` for quick lookup during a poll tick.
 */
async function buildReverseLinkIndex(ctx) {
  const raw = (await ctx.getSetting('userLinks')) || {};
  const map = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const reverse = new Map();
  for (const [discordId, entry] of Object.entries(map)) {
    if (entry?.oscarrUserId) reverse.set(entry.oscarrUserId, discordId);
  }
  return reverse;
}

/**
 * Build the DM embed for a single "media available" notification.
 */
function notifyEmbed(media, lang) {
  const embed = new EmbedBuilder()
    .setTitle(t(lang, 'notify.title'))
    .setDescription(t(lang, 'notify.description', { title: media.title }))
    .setColor(0x10b981)
    .setFooter({ text: t(lang, 'notify.footer') });

  const poster = posterUrl(media.posterPath);
  if (poster) embed.setThumbnail(poster);

  const backdrop = posterUrl(media.backdropPath, 'w780');
  if (backdrop) embed.setImage(backdrop);

  return embed;
}

/**
 * Resolve the locale to use for a given Discord user.
 * Mirrors the cascade from bot.js: explicit user pref → discord locale → global.
 *
 * For background DMs we don't have an `interaction.locale` to lean on, so we
 * fall back to the global `language` plugin setting when there's no explicit
 * user pref.
 */
async function resolveDmLang(ctx, discordId) {
  const links = (await ctx.getSetting('userLocales')) || {};
  const map = typeof links === 'string' ? JSON.parse(links) : links;
  const pref = map[discordId];
  if (pref === 'fr' || pref === 'en') return pref;
  const global = (await ctx.getSetting('language')) || 'fr';
  return global === 'en' ? 'en' : 'fr';
}

/**
 * Main entry point — called from the scheduled job.
 *
 * Strategy:
 *  1. Read `{ lastNotifiedAt, processedIds }` from plugin settings
 *  2. Query Oscarr for notifications since `lastNotifiedAt - LOOKBACK_GRACE_MS`
 *     (the grace window catches out-of-order arrivals from clock skew)
 *  3. Filter out any notification whose id is already in `processedIds`
 *  4. Process the rest (DM or channel fallback)
 *  5. Append delivered/skipped ids to `processedIds`, keep last N (FIFO)
 *  6. Advance `lastNotifiedAt` to the max createdAt we saw
 *
 * Dedup by id is the real guarantee here — the watermark is just an
 * optimization to keep the DB query bounded.
 *
 * @returns {Promise<{ processed: number, delivered: number, skipped: number, pending?: number, error?: string }>}
 */
export async function pollAvailableNotifications(ctx) {
  const state = await readState(ctx);
  const watermark = new Date(state.lastNotifiedAt);
  const since = new Date(watermark.getTime() - LOOKBACK_GRACE_MS);
  const alreadySeen = new Set(state.processedIds);

  let notifications;
  try {
    notifications = await oscarr.listRecentAvailableNotifications(since);
  } catch (err) {
    ctx.log.error(`[Leonarr] notify poll: failed to read notifications: ${err}`);
    return { processed: 0, delivered: 0, skipped: 0, error: String(err) };
  }

  // Drop anything we've already processed in a previous tick
  const fresh = notifications.filter((n) => !alreadySeen.has(n.id));
  if (fresh.length === 0) {
    return { processed: 0, delivered: 0, skipped: 0 };
  }

  // Safety cap: process oldest first, leave the rest for next tick
  const batch = fresh.slice(0, MAX_PER_TICK);

  const reverseLinks = await buildReverseLinkIndex(ctx);
  let delivered = 0;
  let skipped = 0;
  let maxCreatedAt = watermark;
  const newlyProcessed = [];

  for (const notif of batch) {
    const createdAt = notif.createdAt instanceof Date ? notif.createdAt : new Date(notif.createdAt);
    if (createdAt > maxCreatedAt) maxCreatedAt = createdAt;
    newlyProcessed.push(notif.id);

    const discordId = reverseLinks.get(notif.userId);
    if (!discordId) {
      skipped += 1;
      continue;
    }

    let mediaId = null;
    try {
      const metadata = notif.metadata ? JSON.parse(notif.metadata) : {};
      mediaId = metadata.mediaId || null;
    } catch {
      skipped += 1;
      continue;
    }
    if (!mediaId) {
      skipped += 1;
      continue;
    }

    let media;
    try {
      media = await oscarr.getMediaById(mediaId);
    } catch (err) {
      ctx.log.warn(`[Leonarr] notify poll: getMediaById(${mediaId}) failed: ${err}`);
      skipped += 1;
      continue;
    }
    if (!media) {
      skipped += 1;
      continue;
    }

    const lang = await resolveDmLang(ctx, discordId);
    const embed = notifyEmbed(media, lang);

    // Primary delivery: DM
    const dmSent = await sendDM(discordId, { embeds: [embed] });
    if (dmSent) {
      delivered += 1;
      ctx.log.info(
        `[Leonarr] notify: DM'd "${media.title}" to Discord ${discordId} (Oscarr user ${notif.userId})`
      );
      continue;
    }

    // Fallback: post in the last-known guild channel with an @mention
    const fallbackChannelId = await getLastChannel(ctx, discordId);
    if (fallbackChannelId) {
      const channelSent = await sendChannelMention(fallbackChannelId, discordId, { embeds: [embed] });
      if (channelSent) {
        delivered += 1;
        ctx.log.info(
          `[Leonarr] notify: channel-mentioned "${media.title}" to Discord ${discordId} in ${fallbackChannelId} (DM disabled)`
        );
        continue;
      }
    }

    ctx.log.warn(
      `[Leonarr] notify: both DM and channel fallback failed for Discord ${discordId} — "${media.title}"`
    );
    skipped += 1;
  }

  // Merge the new ids into processedIds (FIFO trim to MAX_PROCESSED_IDS)
  const nextProcessedIds = [...state.processedIds, ...newlyProcessed];
  const trimmed = nextProcessedIds.length > MAX_PROCESSED_IDS
    ? nextProcessedIds.slice(nextProcessedIds.length - MAX_PROCESSED_IDS)
    : nextProcessedIds;

  await writeState(ctx, {
    lastNotifiedAt: maxCreatedAt.toISOString(),
    processedIds: trimmed,
  });

  return {
    processed: batch.length,
    delivered,
    skipped,
    pending: fresh.length - batch.length,
  };
}
