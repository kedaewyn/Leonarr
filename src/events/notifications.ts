import type { Client as DiscordClient } from 'discord.js';
import type { Ctx, PluginUserNotificationCreatedV1, PluginMediaAvailableV1 } from '../types.js';

/** Event-bus subscribers — replaces the old cron-polling pattern.
 *
 *  `user.notification.created` fires every time Oscarr persists an in-app notification
 *  (request approved/rejected, media available, plugin-owned events, …). We resolve the
 *  matching Discord id via ctx.getUserProviders and DM that user. If the user isn't
 *  linked, we skip silently — the in-app bell in Oscarr still works.
 *
 *  `media.available` is broadcast-scoped (one fire per piece of media, payload carries all
 *  requester userIds). When the admin configured a `announceChannelId` setting, we post
 *  there too — "📢 Inception is available!" kind of thing. Per-user DMs are already handled
 *  by the user.notification.created handler, so this is additive, not duplicative.
 *
 *  Shutdown: installEventSubscribers returns an `off()` function the plugin lifecycle calls
 *  from onDisable, so subscriber handlers are detached when the plugin is disabled or
 *  unloaded.
 */
export function installEventSubscribers(discordClient: DiscordClient, ctx: Ctx): () => void {
  const onUserNotification = async (raw: unknown): Promise<void> => {
    const ev = raw as PluginUserNotificationCreatedV1 | undefined;
    if (ev?.v !== 1) return; // forward-compat: ignore unknown versions silently

    try {
      const providers = await ctx.getUserProviders(ev.userId);
      const discordLink = providers.find((p) => p.provider === 'discord');
      const discordId = discordLink?.providerId;
      if (!discordId) return; // user never linked Discord — nothing to do

      const dmUser = await discordClient.users.fetch(discordId).catch(() => null);
      if (!dmUser) return; // Discord id invalid or user blocked DMs

      // Keep the DM content compact — Oscarr's notification already carries a translated
      // title + message. Metadata might include posterPath/tmdbId for richer embeds later.
      const body = ev.message ? `${ev.title}\n${ev.message}` : ev.title;
      await dmUser.send({ content: body }).catch((err: unknown) => {
        ctx.log.debug({ err, discordId, type: ev.type }, 'DM delivery failed (user may have DMs disabled)');
      });
    } catch (err) {
      ctx.log.warn({ err, userId: ev.userId, type: ev.type }, 'user.notification.created handler failed');
    }
  };

  const onMediaAvailable = async (raw: unknown): Promise<void> => {
    const ev = raw as PluginMediaAvailableV1 | undefined;
    if (ev?.v !== 1) return;

    try {
      const channelId = await ctx.getSetting('announceChannelId');
      if (typeof channelId !== 'string' || channelId.length === 0) return;

      const channel = await discordClient.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased() || !('send' in channel)) return;

      const url = `https://www.themoviedb.org/${ev.mediaType}/${ev.tmdbId}`;
      const kindEmoji = ev.mediaType === 'movie' ? '🎬' : '📺';
      await channel.send({ content: `📢 **${ev.title}** ${kindEmoji} is available! <${url}>` })
        .catch((err: unknown) => {
          ctx.log.warn({ err, channelId, mediaId: ev.mediaId }, 'announce channel post failed');
        });
    } catch (err) {
      ctx.log.warn({ err, mediaId: ev.mediaId }, 'media.available handler failed');
    }
  };

  ctx.events.on('user.notification.created', onUserNotification);
  ctx.events.on('media.available', onMediaAvailable);

  return function off() {
    ctx.events.off('user.notification.created', onUserNotification);
    ctx.events.off('media.available', onMediaAvailable);
  };
}
