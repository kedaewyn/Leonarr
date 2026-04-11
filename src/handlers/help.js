import { EmbedBuilder, MessageFlags } from 'discord.js';
import { t } from '../i18n.js';

export async function handleHelp(interaction, { lang }) {
  const embed = new EmbedBuilder()
    .setTitle(t(lang, 'help.title'))
    .setColor(0x6366f1)
    .setDescription(
      [
        t(lang, 'help.login'),
        t(lang, 'help.logout'),
        t(lang, 'help.search'),
        t(lang, 'help.status'),
        t(lang, 'help.settings'),
        t(lang, 'help.help'),
      ].join('\n')
    );

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
