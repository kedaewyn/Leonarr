import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { createI18n, resolveInstanceLanguage, type TFn } from '../i18n/index.js';
import type { Ctx } from '../types.js';

export function buildCommand(t: TFn): RESTPostAPIChatInputApplicationCommandsJSONBody {
  return new SlashCommandBuilder()
    .setName(t('cmd.help.name'))
    .setDescription(t('cmd.help.description'))
    .toJSON();
}

export async function handle(
  interaction: ChatInputCommandInteraction,
  ctx: Ctx,
): Promise<void> {
  const lang = await resolveInstanceLanguage(ctx);
  const t = createI18n(lang);

  const embed = new EmbedBuilder()
    .setTitle(t('help.title'))
    .setDescription([
      `\`/${t('cmd.link.name')}\` — ${t('cmd.link.description')}`,
      `\`/${t('cmd.search.name')}\` — ${t('cmd.search.description')}`,
      `\`/${t('cmd.status.name')}\` — ${t('cmd.status.description')}`,
      `\`/${t('cmd.help.name')}\` — ${t('cmd.help.description')}`,
    ].join('\n'))
    .setFooter({ text: t('help.footer') });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
