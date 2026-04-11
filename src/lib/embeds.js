import { EmbedBuilder } from 'discord.js';
import { t } from '../i18n.js';

const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p';

export function posterUrl(path, size = 'w500') {
  if (!path) return null;
  return `${TMDB_IMG_BASE}/${size}${path}`;
}


export function mediaCardEmbed(media, lang = 'fr') {
  const isMovie = media.media_type === 'movie';
  const title = isMovie ? media.title : media.name;
  const year = (isMovie ? media.release_date : media.first_air_date)?.slice(0, 4) || '—';
  const rating = media.vote_average ? `⭐ ${media.vote_average.toFixed(1)}/10` : '';
  const typeLabel = t(lang, isMovie ? 'media.type_movie' : 'media.type_tv');

  const embed = new EmbedBuilder()
    .setTitle(`${title} (${year})`)
    .setDescription(truncate(media.overview, 500) || t(lang, 'media.no_synopsis'))
    .setColor(isMovie ? 0x6366f1 : 0x10b981)
    .setFooter({ text: `${typeLabel}${rating ? ' · ' + rating : ''}` });

  const poster = posterUrl(media.poster_path);
  if (poster) embed.setThumbnail(poster);

  const backdrop = posterUrl(media.backdrop_path, 'w780');
  if (backdrop) embed.setImage(backdrop);

  const badge = statusBadge(media.oscarrStatus, lang);
  if (badge) {
    embed.addFields([{ name: t(lang, 'search.status_field'), value: badge, inline: false }]);
  }

  return embed;
}


function statusBadge(oscarrStatus, lang) {
  if (!oscarrStatus) return null;

  if (oscarrStatus.userHasActiveRequest) {
    return t(lang, 'search.status.pending_user', {
      status: oscarrStatus.userRequestStatus || 'pending',
    });
  }
  if (oscarrStatus.status === 'available') {
    return t(lang, 'search.status.available');
  }
  if (oscarrStatus.status === 'processing') {
    return t(lang, 'search.status.processing');
  }
  return null;
}

/**
 * Classify a request into a display bucket for the /status filter buttons.
 *   - `downloading` : present in the live queue (progressMap has the media id)
 *   - `available`   : persisted status is 'available'
 *   - `waiting`     : everything else (pending, approved, processing, failed,
 *                     declined, searching, upcoming)
 */
export function classifyRequest(request, progressMap) {
  if (progressMap?.has?.(request.media.id)) return 'downloading';
  if (request.status === 'available') return 'available';
  return 'waiting';
}

/**
 * Render a text progress bar (10 chars by default). Renders consistently
 * on web, desktop, and mobile Discord clients.
 */
function progressBar(percent, width = 10) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round((p / 100) * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

/**
 * Humanize a Radarr/Sonarr `timeleft` string into a compact label.
 *   "00:42:15"      → "42m 15s"
 *   "01:30:00"      → "1h 30m"
 *   "1.02:30:00"    → "1d 2h"
 *   "" or invalid   → ""
 */
function humanizeTimeleft(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const m = raw.match(/^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return raw;
  const [, d, h, min, sec] = m;
  const days = parseInt(d || '0', 10);
  const hours = parseInt(h, 10);
  const minutes = parseInt(min, 10);
  const seconds = parseInt(sec, 10);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Format a single request line for the /status embed.
 */
function formatStatusLine(request, progressMap, lang) {
  const type = request.mediaType === 'movie' ? '🎬' : '📺';
  const title = request.media.title;
  const progress = progressMap?.get?.(request.media.id);

  // ─── Live download view ──────────────────────────────────────────
  if (progress) {
    const icon = t(lang, 'status.progress_icon');
    const queueStatus = (progress.status || '').toLowerCase();

    // Non-downloading queue states get their own short label
    if (queueStatus === 'queued' || queueStatus === 'delay' || queueStatus === 'delayed') {
      return `${icon} ${type} **${title}** — ${t(lang, 'status.queued')}`;
    }
    if (queueStatus === 'paused') {
      return `${icon} ${type} **${title}** — ${t(lang, 'status.paused')}`;
    }

    const eta = humanizeTimeleft(progress.timeleft);
    const percent = progress.percent ?? 0;

    // Download just started: no percent, no ETA — show a soft "starting"
    if (percent === 0 && !eta) {
      return `${icon} ${type} **${title}** — ${t(lang, 'status.starting')}`;
    }

    const bar = progressBar(percent, 10);

    if (!eta) {
      return `${icon} ${type} **${title}** — ${t(lang, 'status.progress_no_eta', { bar, percent })}`;
    }

    const tmpl = progress.episodes && progress.episodes > 1 ? 'status.progress_eps' : 'status.progress';
    const detail = t(lang, tmpl, {
      bar,
      percent,
      timeleft: eta,
      episodes: progress.episodes || 1,
    });
    return `${icon} ${type} **${title}** — ${detail}`;
  }

  // ─── Persisted status view ───────────────────────────────────────
  const key = `status.label.${request.status}`;
  const label = t(lang, key);
  const display = label === key ? `\`${request.status}\`` : label;
  return `${type} **${title}** — ${display}`;
}

/**
 * Build a compact list embed for /status, scoped to a filter bucket.
 *
 * @param {Array}   requests    From listUserRequests, pre-filtered by the handler
 * @param {'fr'|'en'} lang
 * @param {object}  [opts]
 * @param {Map<number, any>|null} [opts.progressMap]  Live queue info (all requests, not just filtered)
 * @param {'all'|'downloading'|'waiting'|'available'} [opts.filter='all']  Active bucket
 */
export function statusEmbed(requests, lang = 'fr', opts = {}) {
  const { progressMap = null, filter = 'all' } = opts;

  const titleKey = {
    all: 'status.title_all',
    downloading: 'status.title_downloading',
    waiting: 'status.title_waiting',
    available: 'status.title_available',
  }[filter] || 'status.title_all';

  const embed = new EmbedBuilder()
    .setTitle(t(lang, titleKey))
    .setColor(0x6366f1);

  if (requests.length === 0) {
    embed.setDescription(t(lang, filter === 'all' ? 'status.empty' : 'status.empty_bucket'));
    return embed;
  }

  const lines = requests.map((r) => formatStatusLine(r, progressMap, lang));
  embed.setDescription(lines.join('\n'));
  embed.setFooter({ text: t(lang, 'status.count', { count: requests.length }) });
  return embed;
}


export function seasonPickerEmbed(media, seasonCount, lang = 'fr') {
  const title = media.name || media.title || '';
  const year = media.first_air_date?.slice(0, 4) || '—';

  const embed = new EmbedBuilder()
    .setTitle(t(lang, 'search.season_picker_title'))
    .setDescription(
      `**${title}** _(${year})_\n\n${t(lang, 'search.season_picker_hint')}`
    )
    .setColor(0x10b981);

  const poster = posterUrl(media.poster_path);
  if (poster) embed.setThumbnail(poster);

  embed.setFooter({ text: t(lang, 'search.season_footer_count', { count: seasonCount }) });
  return embed;
}

function truncate(str, max) {
  if (!str) return str;
  if (str.length <= max) return str;
  return str.slice(0, max - 1).trimEnd() + '…';
}
