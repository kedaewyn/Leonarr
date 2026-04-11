import { MessageFlags } from 'discord.js';
import { t } from '../i18n.js';
import { setUserLocale } from '../store.js';

export async function handleSettings(interaction, { ctx, lang }) {
  if (interaction.options.getSubcommand() !== 'language') {
    // Defensive — should not happen since Discord validates subcommands,
    // but future-proof against new subcommands added without handler updates.
    await interaction.reply({
      content: t(lang, 'error.generic', { error: 'unknown subcommand' }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const value = interaction.options.getString('value', true);

  if (value === 'default') {
    await setUserLocale(ctx, interaction.user.id, null);
    ctx.log.info(`[Leonarr] ${interaction.user.tag} reset their locale preference`);
    // Respond in the current effective language — future commands will
    // resolve freshly per interaction.
    await interaction.reply({
      content: t(lang, 'settings.language_reset'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // value is 'fr' or 'en' — respond in the NEW language so the user immediately
  // sees the effect of their choice.
  await setUserLocale(ctx, interaction.user.id, value);
  ctx.log.info(`[Leonarr] ${interaction.user.tag} set locale to ${value}`);
  await interaction.reply({
    content: t(value, 'settings.language_set'),
    flags: MessageFlags.Ephemeral,
  });
}

