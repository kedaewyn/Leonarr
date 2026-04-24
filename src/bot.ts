import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  InteractionType,
  type Interaction,
} from 'discord.js';
import { createI18n, resolveInstanceLanguage } from './i18n/index.js';
import { installEventSubscribers } from './events/notifications.js';
import type { Ctx } from './types.js';

import * as linkCmd from './commands/link.js';
import * as searchCmd from './commands/search.js';
import * as statusCmd from './commands/status.js';
import * as helpCmd from './commands/help.js';

/** Discord bot lifecycle. Started from onEnable in src/index.ts, stopped from onDisable.
 *
 *  Intents: only `Guilds` — we don't read message content (slash-only), we don't need
 *  presence or members. The bot is effectively invisible except when mentioned by slash
 *  commands + DMs for notifications. Keeps the gateway payload tiny.
 *
 *  Command registration: on every start we push the current slash definitions to Discord
 *  (guild-scoped when settings.guildId is set — faster propagation for testing — otherwise
 *  globally). Idempotent: re-registering the same shape is a no-op on Discord's side.
 */
export interface Bot {
  start(ctx: Ctx): Promise<void>;
  stop(ctx: Ctx): Promise<void>;
  isRunning(): boolean;
}

export function createBot(): Bot {
  let client: Client | null = null;
  let eventsOff: (() => void) | null = null;

  async function start(ctx: Ctx): Promise<void> {
    if (client) return; // idempotent — onEnable could be called twice in weird states

    const botToken = await ctx.getSetting('botToken');
    if (typeof botToken !== 'string' || botToken.length === 0) {
      ctx.log.warn('Leonarr botToken not configured — bot not starting. Set it in admin settings.');
      return;
    }
    const clientId = await ctx.getSetting('clientId');
    if (typeof clientId !== 'string' || clientId.length === 0) {
      ctx.log.warn('Leonarr clientId not configured — bot not starting.');
      return;
    }
    const guildIdRaw = await ctx.getSetting('guildId');
    const guildId = typeof guildIdRaw === 'string' && guildIdRaw.length > 0 ? guildIdRaw : null;

    client = new Client({ intents: [GatewayIntentBits.Guilds] });

    // Build command definitions in the instance language — Discord displays this
    // description text to users. Changing the instance language on Oscarr + running
    // /leonarr restart re-registers them in the new locale.
    const lang = await resolveInstanceLanguage(ctx);
    const t = createI18n(lang);
    const commandDefs = [
      linkCmd.buildCommand(t),
      searchCmd.buildCommand(t),
      statusCmd.buildCommand(t),
      helpCmd.buildCommand(t),
    ];

    const rest = new REST({ version: '10' }).setToken(botToken);
    try {
      const route = guildId
        ? Routes.applicationGuildCommands(clientId, guildId)
        : Routes.applicationCommands(clientId);
      await rest.put(route, { body: commandDefs });
      ctx.log.info({ count: commandDefs.length, scope: guildId ? 'guild' : 'global' }, 'Leonarr slash commands registered');
    } catch (err) {
      ctx.log.error({ err }, 'Leonarr slash-command registration failed — check clientId + bot token');
      // Don't crash the plugin; the client may still login and respond to cached commands.
    }

    client.on('interactionCreate', async (interaction: Interaction) => {
      try {
        await dispatch(interaction, ctx);
      } catch (err) {
        const commandName = interaction.isCommand() ? interaction.commandName : undefined;
        ctx.log.error({ err, type: interaction.type, commandName }, 'Leonarr interaction handler threw');
      }
    });

    client.once('ready', () => {
      ctx.log.info({ user: client?.user?.tag }, 'Leonarr Discord bot ready');
    });

    await client.login(botToken);

    // Once we have a live Discord client, wire up the Oscarr event bus so notifications
    // can reach Discord without any polling.
    eventsOff = installEventSubscribers(client, ctx);
  }

  async function stop(ctx: Ctx): Promise<void> {
    if (eventsOff) {
      eventsOff();
      eventsOff = null;
    }
    if (!client) return;
    try {
      await client.destroy();
    } catch (err) {
      ctx.log.warn({ err }, 'Leonarr Discord client destroy failed');
    }
    client = null;
  }

  return { start, stop, isRunning: () => client !== null };
}

/** Central dispatch — maps interaction → handler. Discord commandNames are not localised
 *  (i18n ships them as the same English slug in en/fr bundles), so we match on literals.
 *  Button customIds are namespaced with `leonarr:` to avoid colliding with other plugins'
 *  button traffic on the same client.
 */
async function dispatch(interaction: Interaction, ctx: Ctx): Promise<void> {
  if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
    if (interaction.commandName === 'search') {
      return searchCmd.handleAutocomplete(interaction, ctx);
    }
    await interaction.respond([]);
    return;
  }

  if (interaction.isChatInputCommand()) {
    switch (interaction.commandName) {
      case 'link':   return linkCmd.handle(interaction, ctx);
      case 'search': return searchCmd.handle(interaction, ctx);
      case 'status': return statusCmd.handle(interaction, ctx);
      case 'help':   return helpCmd.handle(interaction, ctx);
      default:       return; // ignore unknown — another plugin might own it in theory
    }
  }

  if (interaction.isButton()) {
    if (!interaction.customId.startsWith('leonarr:')) return;
    if (interaction.customId.startsWith('leonarr:submit:')) return searchCmd.handleSubmitButton(interaction, ctx);
  }
}
