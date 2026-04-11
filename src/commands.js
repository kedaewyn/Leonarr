import { REST, Routes, SlashCommandBuilder, InteractionContextType } from 'discord.js';
import { t } from './i18n.js';

const ALL_CONTEXTS = [
  InteractionContextType.Guild,
  InteractionContextType.BotDM,
  InteractionContextType.PrivateChannel,
];

function frLocalization(key) {
  return { fr: t('fr', key) };
}

export function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName('login')
      .setDescription(t('en', 'cmd.login.desc'))
      .setDescriptionLocalizations(frLocalization('cmd.login.desc'))
      .setContexts(ALL_CONTEXTS),

    new SlashCommandBuilder()
      .setName('logout')
      .setDescription(t('en', 'cmd.logout.desc'))
      .setDescriptionLocalizations(frLocalization('cmd.logout.desc'))
      .setContexts(ALL_CONTEXTS),

    new SlashCommandBuilder()
      .setName('search')
      .setDescription(t('en', 'cmd.search.desc'))
      .setDescriptionLocalizations(frLocalization('cmd.search.desc'))
      .addStringOption((opt) =>
        opt
          .setName('type')
          .setDescription(t('en', 'cmd.search.type_desc'))
          .setDescriptionLocalizations(frLocalization('cmd.search.type_desc'))
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption((opt) =>
        opt
          .setName('query')
          .setDescription(t('en', 'cmd.search.query_desc'))
          .setDescriptionLocalizations(frLocalization('cmd.search.query_desc'))
          .setRequired(true)
      )
      .setContexts(ALL_CONTEXTS),

    new SlashCommandBuilder()
      .setName('status')
      .setDescription(t('en', 'cmd.status.desc'))
      .setDescriptionLocalizations(frLocalization('cmd.status.desc'))
      .setContexts(ALL_CONTEXTS),

    new SlashCommandBuilder()
      .setName('settings')
      .setDescription(t('en', 'cmd.settings.desc'))
      .setDescriptionLocalizations(frLocalization('cmd.settings.desc'))
      .addSubcommand((sub) =>
        sub
          .setName('language')
          .setDescription(t('en', 'cmd.settings.language_desc'))
          .setDescriptionLocalizations(frLocalization('cmd.settings.language_desc'))
          .addStringOption((opt) =>
            opt
              .setName('value')
              .setDescription(t('en', 'cmd.settings.language_value_desc'))
              .setDescriptionLocalizations(frLocalization('cmd.settings.language_value_desc'))
              .setRequired(true)
              .addChoices(
                // Language names stay in their own language by convention.
                { name: 'Français', value: 'fr' },
                { name: 'English', value: 'en' },
                {
                  name: t('en', 'cmd.settings.default_choice'),
                  name_localizations: { fr: t('fr', 'cmd.settings.default_choice') },
                  value: 'default',
                },
              )
          )
      )
      .setContexts(ALL_CONTEXTS),

    new SlashCommandBuilder()
      .setName('help')
      .setDescription(t('en', 'cmd.help.desc'))
      .setDescriptionLocalizations(frLocalization('cmd.help.desc'))
      .setContexts(ALL_CONTEXTS),
  ].map((c) => c.toJSON());
}

export async function registerCommands(opts) {
  const { botToken, clientId, guildId, log } = opts;
  const commands = buildCommands();
  const rest = new REST({ version: '10' }).setToken(botToken);

  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      log.info(`[Leonarr] Registered ${commands.length} guild commands to ${guildId}`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      log.info(`[Leonarr] Registered ${commands.length} global commands`);
    }
  } catch (err) {
    log.error(`[Leonarr] Failed to register commands: ${err}`);
    throw err;
  }
}
