import { load } from '../backend.js';

// Default upper bounds on any call into Oscarr's backend. If a TMDB fetch
// or a prisma query hangs, we bail out rather than let a Discord handler
// pile up behind it. Individual callers can override when they know an
// operation is naturally slower (e.g. createRequest runs the full *arr
// pipeline and can legitimately take longer).
const DEFAULT_TIMEOUT_MS = 10_000;
const LONG_TIMEOUT_MS = 20_000;

/**
 * Race a promise against a timeout, rejecting with a labelled error if the
 * promise doesn't settle in time. Never leaks the timer.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, label) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[Leonarr] ${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

export async function searchMulti(query, lang) {
  const { searchMulti: s } = await load('services/tmdb.js');
  const data = await withTimeout(s(query, 1, lang), DEFAULT_TIMEOUT_MS, 'searchMulti');
  // Keep only movies and TV (drop "person" entries)
  return (data.results || []).filter(
    (r) => r.media_type === 'movie' || r.media_type === 'tv'
  );
}

export async function getMovieDetails(tmdbId, lang) {
  const { getMovieDetails } = await load('services/tmdb.js');
  return withTimeout(getMovieDetails(tmdbId, lang), DEFAULT_TIMEOUT_MS, 'getMovieDetails');
}


export async function getTvDetails(tmdbId, lang) {
  const { getTvDetails } = await load('services/tmdb.js');
  return withTimeout(getTvDetails(tmdbId, lang), DEFAULT_TIMEOUT_MS, 'getTvDetails');
}


export async function findUserByEmail(email) {
  const { prisma } = await load('utils/prisma.js');
  return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
}


export async function findUserByPlexId(plexId) {
  const { prisma } = await load('utils/prisma.js');
  const link = await prisma.userProvider.findUnique({
    where: { provider_providerId: { provider: 'plex', providerId: String(plexId) } },
    include: { user: true },
  });
  return link?.user || null;
}


export async function findOrCreatePlexUser(plexAccount) {
  const { prisma } = await load('utils/prisma.js');
  const { logEvent } = await load('utils/logEvent.js');

  const providerId = String(plexAccount.id);
  const email = plexAccount.email.toLowerCase();

  // 1. Try by provider link
  let link = await prisma.userProvider.findUnique({
    where: { provider_providerId: { provider: 'plex', providerId } },
    include: { user: true },
  });
  let user = link?.user || null;

  // 2. Fall back to email lookup (covers auto-imported users without a provider link yet)
  if (!user) {
    user = await prisma.user.findUnique({ where: { email } });
  }

  if (user) {
    // Ensure the provider link exists and has a fresh token
    await prisma.userProvider.upsert({
      where: { userId_provider: { userId: user.id, provider: 'plex' } },
      update: {
        providerId,
        providerToken: plexAccount.authToken,
        providerUsername: plexAccount.username,
        providerEmail: email,
      },
      create: {
        userId: user.id,
        provider: 'plex',
        providerId,
        providerToken: plexAccount.authToken,
        providerUsername: plexAccount.username,
        providerEmail: email,
      },
    });
    return { user, isNew: false };
  }

  // 3. Create a new user
  const userCount = await prisma.user.count();
  const isFirstUser = userCount === 0;

  user = await prisma.user.create({
    data: {
      email,
      displayName: plexAccount.username,
      avatar: plexAccount.thumb,
      role: isFirstUser ? 'admin' : 'user',
      providers: {
        create: {
          provider: 'plex',
          providerId,
          providerToken: plexAccount.authToken,
          providerUsername: plexAccount.username,
          providerEmail: email,
        },
      },
    },
  });

  logEvent('info', 'Auth', `${user.displayName} connecté via Leonarr (plex)`);
  return { user, isNew: true };
}

export async function getUserWithRole(userId) {
  const { prisma } = await load('utils/prisma.js');
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, displayName: true, role: true, avatar: true },
  });
}

export async function createRequest(user, tmdbId, mediaType, seasons) {
  const { prisma } = await load('utils/prisma.js');
  const {
    validateRequestBody,
    findOrCreateMedia,
    getUserTagName,
    runPluginGuard,
    sendToService,
    isBlacklisted,
  } = await load('services/requestService.js');
  const { logEvent } = await load('utils/logEvent.js');
  const { ACTIVE_REQUEST_STATUSES } = await load('utils/requestStatus.js');

  const validation = validateRequestBody({ tmdbId, mediaType, seasons });
  if (!validation.valid) return { ok: false, error: validation.error, code: 'INVALID' };

  if (user.role !== 'admin') {
    const guard = await runPluginGuard(user.id);
    if (guard?.blocked) return { ok: false, error: guard.error || 'Blocked', code: 'GUARD' };
  }

  const bl = await isBlacklisted(validation.tmdbId, validation.mediaType);
  if (bl.blacklisted) return { ok: false, error: bl.reason || 'blacklisted', code: 'BLACKLIST' };

  const media = await findOrCreateMedia(validation.tmdbId, validation.mediaType);

  const existing = await prisma.mediaRequest.findFirst({
    where: { mediaId: media.id, userId: user.id, status: { in: [...ACTIVE_REQUEST_STATUSES] } },
  });
  if (existing) return { ok: false, error: 'duplicate', code: 'DUPLICATE' };

  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const shouldAutoApprove = user.role === 'admin' || (settings?.autoApproveRequests ?? false);

  const mediaRequest = await prisma.mediaRequest.create({
    data: {
      mediaId: media.id,
      userId: user.id,
      mediaType: validation.mediaType,
      seasons: validation.seasons ? JSON.stringify(validation.seasons) : null,
      status: shouldAutoApprove ? 'approved' : 'pending',
      approvedById: shouldAutoApprove ? user.id : null,
    },
  });

  if (shouldAutoApprove) {
    const tagName = await getUserTagName(user.id);
    const sent = await withTimeout(
      sendToService(media, validation.mediaType, tagName, user.id, validation.seasons, undefined),
      LONG_TIMEOUT_MS,
      'sendToService',
    ).catch(() => false);
    if (!sent) {
      await prisma.mediaRequest.update({
        where: { id: mediaRequest.id },
        data: { status: 'failed' },
      });
      logEvent('error', 'Request', `[Leonarr] Envoi vers service échoué pour "${media.title}"`);
      return { ok: false, error: 'service_unreachable', code: 'SEND_FAILED' };
    }
  }

  logEvent('info', 'Request', `[Leonarr] Demande créée : "${media.title}"`);
  return {
    ok: true,
    status: shouldAutoApprove ? 'approved' : 'pending',
    title: media.title,
    autoApproved: shouldAutoApprove,
  };
}

/**
 * Look up the Oscarr state for a batch of TMDB media. Best-effort: on error
 * it returns `{}` so callers never break on DB hiccups. Pass `log` to get
 * a warning line when something goes wrong (otherwise it's silent).
 *
 * @param {Array<{tmdbId: number, mediaType: 'movie'|'tv'}>} items
 * @param {number | null | undefined} userId
 * @param {{ log?: any }} [opts]
 */
export async function batchStatus(items, userId, opts = {}) {
  if (!Array.isArray(items) || items.length === 0) return {};

  try {
    const { prisma } = await load('utils/prisma.js');
    const { ACTIVE_REQUEST_STATUSES } = await load('utils/requestStatus.js');
    const activeSet = new Set(ACTIVE_REQUEST_STATUSES);

    const limited = items.slice(0, 50);

    const media = await withTimeout(
      prisma.media.findMany({
        where: {
          OR: limited.map((i) => ({ tmdbId: i.tmdbId, mediaType: i.mediaType })),
        },
        include: {
          requests: {
            where: userId ? { userId } : undefined,
            select: { status: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      DEFAULT_TIMEOUT_MS,
      'batchStatus',
    );

    const results = {};
    for (const m of media) {
      const key = `${m.mediaType}:${m.tmdbId}`;
      const userRequest = m.requests[0] || null;
      results[key] = {
        status: m.status,
        userRequestStatus: userRequest?.status || null,
        userHasActiveRequest: userRequest ? activeSet.has(userRequest.status) : false,
      };
    }
    return results;
  } catch (err) {
    opts.log?.warn?.(`[Leonarr] batchStatus failed: ${err?.message || err}`);
    return {};
  }
}


/**
 * List the available search categories pulled live from Oscarr. Best-effort:
 * on error it returns `[]` so the autocomplete response can fall back to
 * empty. Pass `log` to surface failures in the plugin log.
 *
 * @param {{ log?: any }} [opts]
 */
export async function listSearchCategories(opts = {}) {
  try {
    const { prisma } = await load('utils/prisma.js');
    const [settings, rules] = await withTimeout(
      Promise.all([
        prisma.appSettings.findUnique({ where: { id: 1 } }),
        prisma.folderRule.findMany({
          where: { enabled: true },
          orderBy: { priority: 'asc' },
          select: { id: true, name: true, mediaType: true, seriesType: true },
        }),
      ]),
      DEFAULT_TIMEOUT_MS,
      'listSearchCategories',
    );

    const categories = [];

    // Defaults — always present (hardcoded triad matching Oscarr's AppSettings)
    categories.push({
      id: 'default:movie',
      labelKey: 'search.cat.movie',
      ruleName: null,
      mediaType: 'movie',
      seriesType: null,
      isRule: false,
    });
    categories.push({
      id: 'default:tv',
      labelKey: 'search.cat.tv',
      ruleName: null,
      mediaType: 'tv',
      seriesType: null,
      isRule: false,
    });
    if (settings?.defaultAnimeFolder) {
      categories.push({
        id: 'default:anime',
        labelKey: 'search.cat.anime',
        ruleName: null,
        mediaType: 'tv',
        seriesType: 'anime',
        isRule: false,
      });
    }

    // Append enabled folder rules
    for (const rule of rules) {
      categories.push({
        id: `rule:${rule.id}`,
        labelKey: null,
        ruleName: rule.name,
        mediaType: rule.mediaType,
        seriesType: rule.seriesType || null,
        isRule: true,
      });
    }

    return categories;
  } catch (err) {
    opts.log?.warn?.(`[Leonarr] listSearchCategories failed: ${err?.message || err}`);
    return [];
  }
}

export async function resolveCategoryById(id) {
  const categories = await listSearchCategories();
  return categories.find((c) => c.id === id) || null;
}


export async function getDownloadProgress(mediaList, opts = {}) {
  const out = new Map();
  if (!Array.isArray(mediaList) || mediaList.length === 0) return out;

  const movies = mediaList.filter((m) => m.mediaType === 'movie');
  const shows = mediaList.filter((m) => m.mediaType === 'tv');
  if (movies.length === 0 && shows.length === 0) return out;

  const { getAllServices } = await load('utils/services.js');
  const providers = await load('providers/index.js');
  const getClient = providers.getArrClientForService;
  const log = opts.log;

  const percentOf = (size, sizeleft) => {
    if (!size || size <= 0) return 0;
    const pct = ((size - sizeleft) / size) * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
  };

  const parseTimeleft = (s) => {
    if (!s || typeof s !== 'string') return null;
    const match = s.match(/^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})$/);
    if (!match) return null;
    const [, d, h, m, sec] = match;
    return (parseInt(d || '0', 10) * 86400)
      + (parseInt(h, 10) * 3600)
      + (parseInt(m, 10) * 60)
      + parseInt(sec, 10);
  };

  const matchRadarr = (item) => {
    if (item.movieId) {
      const byId = movies.find((m) => m.radarrId === item.movieId);
      if (byId) return byId;
    }
    const embeddedTmdb = item.movie?.tmdbId;
    if (embeddedTmdb) {
      const byTmdb = movies.find((m) => m.tmdbId === embeddedTmdb);
      if (byTmdb) return byTmdb;
    }
    return null;
  };

  const matchSonarr = (item) => {
    if (item.seriesId) {
      const byId = shows.find((m) => m.sonarrId === item.seriesId);
      if (byId) return byId;
    }
    const series = item.series || {};
    if (series.tvdbId) {
      const byTvdb = shows.find((m) => m.tvdbId === series.tvdbId);
      if (byTvdb) return byTvdb;
    }
    if (series.tmdbId) {
      const byTmdb = shows.find((m) => m.tmdbId === series.tmdbId);
      if (byTmdb) return byTmdb;
    }
    return null;
  };

  // ─── Radarr ─────────────────────────────────────────────────────
  if (movies.length > 0) {
    const services = await getAllServices('radarr').catch(() => []);
    log?.debug?.(`[Leonarr] getDownloadProgress: ${services.length} radarr service(s), ${movies.length} movie(s) to match`);
    for (const svc of services) {
      try {
        const client = getClient(svc.id, 'radarr', svc.config);
        const { records = [] } = await withTimeout(client.getQueue(), DEFAULT_TIMEOUT_MS, `${svc.name} getQueue`);
        log?.debug?.(`[Leonarr] radarr "${svc.name}" queue: ${records.length} record(s)`);
        for (const item of records) {
          const media = matchRadarr(item);
          if (!media) continue;
          const prev = out.get(media.id);
          const pct = percentOf(item.size, item.sizeleft);
          if (!prev || pct > prev.percent) {
            out.set(media.id, {
              percent: pct,
              timeleft: item.timeleft || '',
              status: item.status || 'downloading',
            });
          }
        }
      } catch (err) {
        log?.warn?.(`[Leonarr] radarr "${svc.name}" getQueue failed: ${err?.message || err}`);
      }
    }
  }

  // ─── Sonarr (one item per episode, aggregate per series) ────────
  if (shows.length > 0) {
    const accum = new Map();
    const services = await getAllServices('sonarr').catch(() => []);
    log?.debug?.(`[Leonarr] getDownloadProgress: ${services.length} sonarr service(s), ${shows.length} show(s) to match`);
    for (const svc of services) {
      try {
        const client = getClient(svc.id, 'sonarr', svc.config);
        const { records = [] } = await withTimeout(client.getQueue(), DEFAULT_TIMEOUT_MS, `${svc.name} getQueue`);
        log?.debug?.(`[Leonarr] sonarr "${svc.name}" queue: ${records.length} record(s)`);
        for (const item of records) {
          const media = matchSonarr(item);
          if (!media) continue;

          const entry = accum.get(media.id) || {
            totalSize: 0,
            totalLeft: 0,
            minSec: Infinity,
            timeleft: '',
            status: 'downloading',
            episodes: 0,
          };
          entry.totalSize += item.size || 0;
          entry.totalLeft += item.sizeleft || 0;
          entry.episodes += 1;
          entry.status = item.status || entry.status;

          const sec = parseTimeleft(item.timeleft);
          if (sec != null && sec < entry.minSec) {
            entry.minSec = sec;
            entry.timeleft = item.timeleft;
          } else if (!entry.timeleft && item.timeleft) {
            entry.timeleft = item.timeleft;
          }
          accum.set(media.id, entry);
        }
      } catch (err) {
        log?.warn?.(`[Leonarr] sonarr "${svc.name}" getQueue failed: ${err?.message || err}`);
      }
    }
    for (const [mediaId, entry] of accum) {
      out.set(mediaId, {
        percent: percentOf(entry.totalSize, entry.totalLeft),
        timeleft: entry.timeleft,
        status: entry.status,
        episodes: entry.episodes,
      });
    }
  }

  log?.debug?.(`[Leonarr] getDownloadProgress matched ${out.size} / ${mediaList.length} media`);
  return out;
}

/**
 * Fetch `UserNotification` rows of type `media_available` created since the
 * given timestamp. Used by the background poller to DM Discord-linked users
 * when their requested media lands in Plex.
 *
 * @param {Date} since   Lower bound (exclusive) on `createdAt`
 * @returns {Promise<Array<{
 *   id: number,
 *   userId: number,
 *   type: string,
 *   title: string,
 *   message: string,
 *   metadata: string | null,
 *   createdAt: Date,
 * }>>}
 */
export async function listRecentAvailableNotifications(since) {
  const { prisma } = await load('utils/prisma.js');
  return prisma.userNotification.findMany({
    where: {
      type: 'media_available',
      createdAt: { gt: since },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Fetch a single media row by id (used to enrich a notification with poster,
 * title, etc. before the DM is sent).
 * @param {number} mediaId
 */
export async function getMediaById(mediaId) {
  const { prisma } = await load('utils/prisma.js');
  return prisma.media.findUnique({
    where: { id: mediaId },
    select: {
      id: true,
      title: true,
      posterPath: true,
      backdropPath: true,
      mediaType: true,
      tmdbId: true,
      overview: true,
    },
  });
}

/**
 * List the user's recent media requests.
 * @param {number} userId
 * @param {number} [limit]
 */
export async function listUserRequests(userId, limit = 10) {
  const { prisma } = await load('utils/prisma.js');
  return prisma.mediaRequest.findMany({
    where: { userId },
    include: {
      media: {
        select: {
          id: true,
          title: true,
          posterPath: true,
          mediaType: true,
          tmdbId: true,
          tvdbId: true,
          radarrId: true,
          sonarrId: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
