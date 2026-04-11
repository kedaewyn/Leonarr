import { Client, Events, GatewayIntentBits, MessageFlags, Partials } from 'discord.js';
import { registerCommands } from './commands.js';
import { handleLogin, handleLogout } from './handlers/login.js';
import {
  handleSearch,
  handleSearchButton,
  handleSearchSelect,
  handleSearchAutocomplete,
  startCleanupTimer as startSearchCleanup,
  stopCleanupTimer as stopSearchCleanup,
} from './handlers/search.js';
import {
  handleStatus,
  handleStatusButton,
  startCleanupTimer as startStatusCleanup,
  stopCleanupTimer as stopStatusCleanup,
} from './handlers/status.js';
import { handleHelp } from './handlers/help.js';
import { handleSettings } from './handlers/settings.js';
import { initLogger, closeLogger, wrapCtx } from './logger.js';
import { getUserLocale, setLastChannel, clearLocaleCache } from './store.js';

async function resolveLang(ctx, interaction, defaultLang) {
  const pref = await getUserLocale(ctx, interaction.user.id);
  if (pref === 'fr' || pref === 'en') return pref;

  const discordLocale = interaction.locale || '';
  const short = discordLocale.split('-')[0].toLowerCase();
  if (short === 'fr' || short === 'en') return short;

  return defaultLang;
}

let client = null;
let currentTokenHash = null;

function hashToken(token) {
  return token ? `${token.length}:${token.slice(-6)}` : null;
}

async function readSettings(ctx) {
  const botToken = await ctx.getSetting('botToken');
  const clientId = await ctx.getSetting('clientId');
  const guildId = await ctx.getSetting('guildId');
  const language = (await ctx.getSetting('language')) || 'fr';
  const requireLogin = await ctx.getSetting('requireLogin');
  const logDir = await ctx.getSetting('logDir');
  const logLevel = await ctx.getSetting('logLevel');

  return {
    botToken,
    clientId,
    guildId: guildId || null,
    lang: language === 'en' ? 'en' : 'fr',
    requireLogin: requireLogin !== false, // default true
    logDir: logDir || null,
    logLevel: logLevel || 'info',
  };
}

export async function start(rawCtx) {
  const settings = await readSettings(rawCtx);
  await initLogger({
    logDir: settings.logDir,
    logLevel: settings.logLevel,
    fallbackLog: rawCtx.log,
  });
  const ctx = wrapCtx(rawCtx);

  if (!settings.botToken || !settings.clientId) {
    ctx.log.warn(
      '[Leonarr] Bot token or client ID missing — skipping Discord startup. ' +
      'Set them in the plugin settings then toggle the plugin to restart.'
    );
    return;
  }

  if (client && currentTokenHash === hashToken(settings.botToken)) {
    ctx.log.info('[Leonarr] Discord client already running with the same token — skipping start');
    return;
  }

  if (client) await stop();

  // Start background GC timers for search/status sessions. Safe to call
  // repeatedly — startCleanupTimer is idempotent.
  startSearchCleanup();
  startStatusCleanup();

  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel], // needed to receive DMs
  });

  client.once(Events.ClientReady, async (c) => {
    ctx.log.info(`[Leonarr] Logged in as ${c.user.tag}`);
    try {
      await registerCommands({
        botToken: settings.botToken,
        clientId: settings.clientId,
        guildId: settings.guildId,
        log: ctx.log,
      });
    } catch (err) {
      ctx.log.error(`[Leonarr] Command registration failed on ready: ${err}`);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isAutocomplete()) {
      try {
        const effectiveLang = await resolveLang(ctx, interaction, settings.lang);
        if (interaction.commandName === 'search') {
          await handleSearchAutocomplete(interaction, { ctx, lang: effectiveLang });
        } else {
          await interaction.respond([]);
        }
      } catch (err) {
        ctx.log.error(`[Leonarr] Autocomplete crashed: ${err?.stack || err}`);
        try { await interaction.respond([]); } catch { /* ignore */ }
      }
      return;
    }

    const effectiveLang = await resolveLang(ctx, interaction, settings.lang);
    const context = { ctx, lang: effectiveLang, requireLogin: settings.requireLogin };

    // Remember the channel this user just invoked a slash command in, so
    // the background notification poller can fall back to channel mentions
    // when DMs are disabled. Guild channels only — skip DMs.
    if (interaction.isChatInputCommand() && interaction.guildId && interaction.channelId) {
      setLastChannel(ctx, interaction.user.id, interaction.channelId).catch(() => {});
    }

    try {
      if (interaction.isChatInputCommand()) {
        switch (interaction.commandName) {
          case 'login':    return handleLogin(interaction, context);
          case 'logout':   return handleLogout(interaction, context);
          case 'search':   return handleSearch(interaction, context);
          case 'status':   return handleStatus(interaction, context);
          case 'settings': return handleSettings(interaction, context);
          case 'help':     return handleHelp(interaction, context);
        }
      } else if (interaction.isButton() && interaction.customId.startsWith('leonarr:search:')) {
        return handleSearchButton(interaction, context);
      } else if (interaction.isButton() && interaction.customId.startsWith('leonarr:status:')) {
        return handleStatusButton(interaction, context);
      } else if (interaction.isStringSelectMenu() && interaction.customId.startsWith('leonarr:search:')) {
        return handleSearchSelect(interaction, context);
      }
    } catch (err) {
      ctx.log.error(`[Leonarr] Interaction handler crashed: ${err?.stack || err}`);
      try {
        if (interaction.isRepliable()) {
          const payload = { content: 'Oups, une erreur est survenue.', flags: MessageFlags.Ephemeral };
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp(payload);
          } else {
            await interaction.reply(payload);
          }
        }
      } catch { /* swallow */ }
    }
  });

  client.on(Events.Error, (err) => {
    ctx.log.error(`[Leonarr] Discord client error: ${err}`);
  });

  try {
    await client.login(settings.botToken);
    currentTokenHash = hashToken(settings.botToken);
  } catch (err) {
    ctx.log.error(`[Leonarr] Discord login failed: ${err}`);
    client = null;
    currentTokenHash = null;
    throw err;
  }
}

export async function stop() {
  // Stop session GC + drop in-memory state so a restart starts fresh.
  stopSearchCleanup();
  stopStatusCleanup();
  clearLocaleCache();

  if (client) {
    try {
      await client.destroy();
    } catch { /* ignore */ }
    client = null;
    currentTokenHash = null;
  }
  await closeLogger();
}

export function isRunning() {
  return client !== null && client.isReady();
}

/**
 * Send a direct message to a Discord user from outside an interaction
 * context — typically called from the background notification poller.
 *
 * Returns true on success, false if DMs are disabled or the user cannot be
 * reached. Never throws — callers just log and move on.
 *
 * @param {string} discordId
 * @param {object} payload  discord.js message payload (content, embeds, components)
 * @returns {Promise<boolean>}
 */
export async function sendDM(discordId, payload) {
  if (!client || !client.isReady()) return false;
  try {
    const user = await client.users.fetch(discordId);
    if (!user) return false;
    const dm = await user.createDM();
    await dm.send(payload);
    return true;
  } catch {
    // User has DMs disabled or blocked the bot — silent failure.
    return false;
  }
}

/**
 * Post a message in a guild channel with an @mention for a given user.
 * Used as a fallback when DMs fail in the background notification poller.
 *
 * Returns true on success, false otherwise. Never throws.
 *
 * @param {string} channelId
 * @param {string} discordId
 * @param {object} payload  discord.js message payload
 */
export async function sendChannelMention(channelId, discordId, payload) {
  if (!client || !client.isReady()) return false;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isSendable?.()) return false;
    const content = payload.content ? `<@${discordId}> ${payload.content}` : `<@${discordId}>`;
    await channel.send({
      ...payload,
      content,
      allowedMentions: { users: [discordId] },
    });
    return true;
  } catch {
    return false;
  }
}
