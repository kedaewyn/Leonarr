/**
 * In-memory TTL-indexed session store shared between /search and /status.
 *
 * Each handler used to carry its own copy of the Map, the TTL constant, the
 * cleanupSessions() helper, and the start/stop timer exports. That was fine
 * at v0.1.0 but Qodana flagged it as duplicated code, and the risk of drift
 * is real: when one handler evolves its session shape we don't want the
 * other one to lag behind on the GC strategy.
 *
 * The factory returns an object with:
 *   - `sessions`   Map<string, { expiresAt: number, ... }>
 *   - `ttlMs`      default TTL applied to new sessions
 *   - `startCleanupTimer()` / `stopCleanupTimer()` lifecycle hooks
 *
 * Consumers stay in charge of *creating* sessions (the shape is handler-
 * specific) — they just need to set `expiresAt = Date.now() + ttlMs` so the
 * background GC picks them up when stale.
 *
 * @param {object} [opts]
 * @param {number} [opts.ttlMs]              Session TTL (default 10 min)
 * @param {number} [opts.cleanupIntervalMs]  GC tick interval (default 2 min)
 */
export function createSessionStore({
  ttlMs = 10 * 60 * 1000,
  cleanupIntervalMs = 2 * 60 * 1000,
} = {}) {
  const sessions = new Map();
  let cleanupTimer = null;

  function cleanupExpired() {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (s.expiresAt < now) sessions.delete(id);
    }
  }

  return {
    sessions,
    ttlMs,

    /** Start the background GC. Safe to call multiple times. */
    startCleanupTimer() {
      if (cleanupTimer) return;
      cleanupTimer = setInterval(cleanupExpired, cleanupIntervalMs);
      cleanupTimer.unref?.();
    },

    /** Stop the GC and drop every session — called on bot shutdown/restart. */
    stopCleanupTimer() {
      if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }
      sessions.clear();
    },
  };
}
