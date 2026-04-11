import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { t } from '../i18n.js';
import { getLink, setLink, removeLink } from '../store.js';
import * as plex from '../lib/plex.js';
import * as oscarr from '../lib/oscarr.js';

export async function handleLogin(interaction, { ctx, lang }) {
  const existing = await getLink(ctx, interaction.user.id);
  if (existing) {
    await interaction.reply({
      content: t(lang, 'login.already_linked', { name: existing.plexUsername }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Defer because Plex PIN creation makes an HTTP call
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let pinResult;
  try {
    pinResult = await plex.createPin();
  } catch (err) {
    ctx.log.error(`[Leonarr] Plex PIN creation failed: ${err}`);
    await interaction.editReply(t(lang, 'error.generic', { error: 'Plex unreachable' }));
    return;
  }

  const { pin, authUrl } = pinResult;

  const embed = new EmbedBuilder()
    .setTitle('Plex ↔ Oscarr')
    .setDescription(t(lang, 'login.intro'))
    .setColor(0xe5a00d);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(t(lang, 'login.button'))
      .setStyle(ButtonStyle.Link)
      .setURL(authUrl)
  );

  // Only the user who ran the command sees this message, so it's private.
  await interaction.editReply({
    embeds: [embed],
    components: [row],
  });

  const notify = async (content) => {
    try {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } catch (err) {
      ctx.log.warn(`[Leonarr] Failed to notify login result: ${err}`);
    }
  };

  let pinResolution;
  try {
    pinResolution = await plex.waitForPin(pin.id);
  } catch (err) {
    ctx.log.error(`[Leonarr] Plex PIN polling failed: ${err}`);
    await notify(t(lang, 'error.generic', { error: 'Plex polling failed' }));
    return;
  }

  if (!pinResolution) {
    await notify(t(lang, 'login.timeout'));
    return;
  }

  try {
    const { user, isNew } = await oscarr.findOrCreatePlexUser(pinResolution.account);
    await setLink(ctx, interaction.user.id, {
      oscarrUserId: user.id,
      plexUsername: pinResolution.account.username,
      linkedAt: new Date().toISOString(),
    });
    ctx.log.info(
      `[Leonarr] Discord ${interaction.user.tag} linked to Oscarr user ${user.id} (${user.displayName})${isNew ? ' — new' : ''}`
    );
    await notify(t(lang, 'login.success', { name: user.displayName || pinResolution.account.username }));
  } catch (err) {
    ctx.log.error(`[Leonarr] Failed to link Oscarr user after Plex auth: ${err}`);
    await notify(t(lang, 'error.generic', { error: 'Linking failed' }));
  }
}

export async function handleLogout(interaction, { ctx, lang }) {
  const existing = await getLink(ctx, interaction.user.id);
  if (!existing) {
    await interaction.reply({ content: t(lang, 'logout.not_linked'), flags: MessageFlags.Ephemeral });
    return;
  }
  await removeLink(ctx, interaction.user.id);
  await interaction.reply({ content: t(lang, 'logout.done'), flags: MessageFlags.Ephemeral });
}
