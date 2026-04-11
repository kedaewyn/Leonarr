/**
 * Persistent state for Leonarr, stored in the Oscarr plugin settings blob.
 *
 * Oscarr's `ctx.setSetting(key, value)` does a read-modify-write on the
 * *entire* PluginState row: it loads the blob, patches the key, and writes
 * the blob back. That means two concurrent `setSetting` calls — even on
 * different keys — can race and lose data (the second write overwrites
 * whatever the first one added).
 *
 * To make this safe we funnel *every* mutation through `withSettingsLock`,
 * a single promise chain that serializes plugin-wide writes. Read-only
 * operations don't need the lock and go straight through.
 *
 * A small in-memory cache for user locale lookups avoids hammering
 * `getSetting` on every Discord interaction. It's invalidated on write.
 */

const LINKS_KEY = 'userLinks';
const LOCALE_KEY = 'userLocales';
const CHANNEL_KEY = 'userChannels';

/** @typedef {{ oscarrUserId: number, plexUsername: string, linkedAt: string }} LinkEntry */
/** @typedef {'fr'|'en'} Locale */

// ─── Serialization for all plugin setting mutations ─────────────────

let settingsLockChain = Promise.resolve();

/**
 * Serialize a setting mutation behind all prior mutations. Concurrent callers
 * queue up and execute one at a time. The chain never breaks on rejection —
 * a failure in one call doesn't block the next.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withSettingsLock(fn) {
  const next = settingsLockChain.catch(() => {}).then(fn);
  // Keep the chain alive even if the current call rejects — we don't want
  // to block future writes on a transient error.
  settingsLockChain = next.catch(() => {});
  return next;
}

// ─── Generic blob reader (defensive — tolerates string settings) ───

function normalizeMap(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw;
}

async function readBlob(ctx, key) {
  const raw = await ctx.getSetting(key);
  return normalizeMap(raw);
}

// ─── Discord ↔ Oscarr user links ────────────────────────────────────

/**
 * @param {object} ctx  Oscarr PluginContext
 * @param {string} discordId
 * @returns {Promise<LinkEntry | null>}
 */
export async function getLink(ctx, discordId) {
  const map = await readBlob(ctx, LINKS_KEY);
  return map[discordId] || null;
}

/**
 * @param {object} ctx
 * @param {string} discordId
 * @param {LinkEntry} entry
 */
export async function setLink(ctx, discordId, entry) {
  await withSettingsLock(async () => {
    const map = await readBlob(ctx, LINKS_KEY);
    map[discordId] = entry;
    await ctx.setSetting(LINKS_KEY, map);
  });
}

/**
 * @param {object} ctx
 * @param {string} discordId
 */
export async function removeLink(ctx, discordId) {
  await withSettingsLock(async () => {
    const map = await readBlob(ctx, LINKS_KEY);
    delete map[discordId];
    await ctx.setSetting(LINKS_KEY, map);
  });
}

// ─── Per-user locale preference ─────────────────────────────────────

/**
 * In-memory cache for user locale lookups. Reading plugin settings on every
 * Discord interaction is wasteful (each hit reads the whole plugin state
 * row). We cache the resolved pref for 60 seconds and invalidate on write.
 *
 * discordId → { value: 'fr'|'en'|null, expiresAt: ms }
 */
const localeCache = new Map();
const LOCALE_CACHE_TTL_MS = 60_000;

function invalidateLocaleCache(discordId) {
  if (discordId) {
    localeCache.delete(discordId);
  } else {
    localeCache.clear();
  }
}

/**
 * Get a user's explicit locale override. Returns null if the user hasn't set one.
 * Uses a short-lived in-memory cache to absorb bursts of interactions.
 *
 * @param {object} ctx
 * @param {string} discordId
 * @returns {Promise<Locale | null>}
 */
export async function getUserLocale(ctx, discordId) {
  const now = Date.now();
  const cached = localeCache.get(discordId);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const map = await readBlob(ctx, LOCALE_KEY);
  const raw = map[discordId];
  const value = raw === 'fr' || raw === 'en' ? raw : null;

  localeCache.set(discordId, { value, expiresAt: now + LOCALE_CACHE_TTL_MS });
  return value;
}

/**
 * Set or clear a user's locale override. Pass `null` to clear.
 * Invalidates the in-memory cache on write.
 *
 * @param {object} ctx
 * @param {string} discordId
 * @param {Locale | null} locale
 */
export async function setUserLocale(ctx, discordId, locale) {
  await withSettingsLock(async () => {
    const map = await readBlob(ctx, LOCALE_KEY);
    if (locale === null) {
      delete map[discordId];
    } else {
      map[discordId] = locale;
    }
    await ctx.setSetting(LOCALE_KEY, map);
  });
  invalidateLocaleCache(discordId);
}

/**
 * Clear the full locale cache — called on bot.stop() to avoid stale entries
 * after a plugin restart.
 */
export function clearLocaleCache() {
  invalidateLocaleCache(null);
}

// ─── Per-user "last interacted channel" (for DM fallback) ───────────

/**
 * Remember the guild channel a user just invoked a slash command in. Used
 * as a fallback destination when the background notification poller can't
 * deliver a DM — we post in this channel with an @mention instead.
 *
 * Only guild channel IDs should be stored — don't track DM channels.
 *
 * @param {object} ctx
 * @param {string} discordId
 * @param {string} channelId
 */
export async function setLastChannel(ctx, discordId, channelId) {
  await withSettingsLock(async () => {
    const map = await readBlob(ctx, CHANNEL_KEY);
    map[discordId] = { channelId, updatedAt: new Date().toISOString() };
    await ctx.setSetting(CHANNEL_KEY, map);
  });
}

/**
 * @param {object} ctx
 * @param {string} discordId
 * @returns {Promise<string | null>}
 */
export async function getLastChannel(ctx, discordId) {
  const map = await readBlob(ctx, CHANNEL_KEY);
  return map[discordId]?.channelId || null;
}
