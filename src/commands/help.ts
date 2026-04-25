import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { createI18n, resolveInstanceLanguage, type TFn } from '../i18n/index.js';
import type { Ctx } from '../types.js';

// Hardcoded slug — see comment in commands/link.ts. Dispatch keys against this literal.
export function buildCommand(t: TFn): RESTPostAPIChatInputApplicationCommandsJSONBody {
  return new SlashCommandBuilder()
    .setName('help')
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
      `\`/link\` — ${t('cmd.link.description')}`,
      `\`/search\` — ${t('cmd.search.description')}`,
      `\`/status\` — ${t('cmd.status.description')}`,
      `\`/help\` — ${t('cmd.help.description')}`,
    ].join('\n'))
    .setFooter({ text: t('help.footer') });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}
