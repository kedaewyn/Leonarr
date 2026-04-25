import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { createI18n, resolveInstanceLanguage, type TFn } from '../i18n/index.js';
import type { Ctx, PluginMediaRequest } from '../types.js';

/** `/status` — user's latest requests + live queue progress from the *arr services.
 *
 *  Flow:
 *    1. ctx.requests.listForUser — 10 most recent requests (limit enforced by ctx, we're not
 *       paginating here; users who need more open the Oscarr web UI).
 *    2. For each request in a searching/processing state, look up its download progress on
 *       the matching *arr client (via ctx.getArrClients, pluriel — multi-instance safe).
 *       We query all radarrs + all sonarrs once each and then match requests to queue items
 *       by tmdb/tvdb id, instead of N calls per request.
 *    3. Render one embed row per request with its status + progress bar if applicable.
 */

const IN_FLIGHT = new Set(['pending', 'approved', 'searching', 'processing']);

interface QueueSnapshot {
  percent: number;
  state: string;
}

// Hardcoded slug — see comment in commands/link.ts. Dispatch keys against this literal.
export function buildCommand(t: TFn): RESTPostAPIChatInputApplicationCommandsJSONBody {
  return new SlashCommandBuilder()
    .setName('status')
    .setDescription(t('cmd.status.description'))
    .toJSON();
}

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

  await interaction.deferReply({ ephemeral: true });

  const requests = await ctx.requests.listForUser(user.id, { limit: 10 });
  if (requests.length === 0) {
    await interaction.editReply({ content: t('status.empty') });
    return;
  }

  // Only fetch queues if we have at least one in-flight request — most users checking after
  // a completed sync would otherwise pay the *arr round-trip for nothing.
  const needsQueue = requests.some((r) => IN_FLIGHT.has(r.status) || IN_FLIGHT.has(r.media.status));
  const progressByKey = needsQueue ? await fetchQueueProgress(ctx) : new Map<string, QueueSnapshot>();

  const embed = new EmbedBuilder()
    .setTitle(t('status.heading'))
    .setDescription(
      requests.map((r) => renderLine(r, progressByKey, t)).join('\n'),
    );

  await interaction.editReply({ embeds: [embed] });
}

function renderLine(
  r: PluginMediaRequest,
  progressByKey: Map<string, QueueSnapshot>,
  t: TFn,
): string {
  const title = r.media.title || `#${r.media.tmdbId}`;
  const statusKey = `status.status.${r.status}` as Parameters<TFn>[0];
  const statusLabel = t(statusKey);

  // Radarr queue items are keyed by tmdbId, Sonarr's by tvdbId — PluginMedia carries both.
  const externalId = r.media.mediaType === 'movie' ? r.media.tmdbId : r.media.tvdbId;
  const queue = externalId ? progressByKey.get(`${r.media.mediaType}:${externalId}`) : undefined;
  const progress = queue
    ? ` · ${t('status.queue.progress', { percent: queue.percent, state: queue.state })}`
    : '';

  return `• **${title}** — ${statusLabel}${progress}`;
}

/** One findMany per *arr service type, keyed by `${mediaType}:${externalId}`. Falls back to
 *  tvdbId for Sonarr entries (Sonarr's queue carries tvdbId, Radarr's carries tmdbId). */
async function fetchQueueProgress(ctx: Ctx): Promise<Map<string, QueueSnapshot>> {
  const result = new Map<string, QueueSnapshot>();

  const pairs: Array<['radarr' | 'sonarr', 'movie' | 'tv']> = [
    ['radarr', 'movie'],
    ['sonarr', 'tv'],
  ];
  for (const [type, mediaType] of pairs) {
    let clients;
    try {
      clients = await ctx.getArrClients(type);
    } catch (err) {
      // Likely the service type isn't declared in manifest.services; skip silently rather
      // than failing the whole /status call — the user still sees text-level statuses.
      ctx.log.debug({ err, type }, `Skipping queue lookup for ${type}`);
      continue;
    }
    for (const client of clients) {
      try {
        const queue = await client.getQueue();
        for (const item of queue ?? []) {
          // Radarr exposes `tmdbId` on the `movie` sub-object; Sonarr exposes `tvdbId` on
          // `series`. We normalise both to "<mediaType>:<externalId>" so `renderLine` can
          // match against the media's tmdbId / tvdbId without branching.
          const externalId = type === 'radarr'
            ? item.movie?.tmdbId
            : item.series?.tvdbId;
          if (!externalId) continue;
          const percent = Math.max(0, Math.min(100, Math.round(
            100 * (1 - (item.sizeleft ?? 0) / Math.max(1, item.size ?? 1)),
          )));
          result.set(`${mediaType}:${externalId}`, { percent, state: item.status || 'downloading' });
        }
      } catch (err) {
        ctx.log.debug({ err, type }, `Queue fetch failed on ${type}`);
      }
    }
  }
  return result;
}
