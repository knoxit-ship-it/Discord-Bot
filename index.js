require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

const axios = require('axios');
const { parse } = require('csv-parse/sync');

const TOKEN = process.env.DISCORD_TOKEN;

const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/15ob2eDEYiu8VA8wUkYEQU0xA6Z3ywnPvSEVixWXEfao/export?format=csv&gid=1587560849';

function logEvent(type, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    type,
    ...data
  };

  // Railway captures this in the Logs tab
  console.log(JSON.stringify(entry));
}

const DIAMOND_TIERS = [
  { value: 100000, name: 'Tier 2' },
  { value: 200000, name: 'Tier 3' },
  { value: 300000, name: 'Tier 4' },
  { value: 500000, name: 'Tier 5' },
  { value: 700000, name: 'Tier 6' },
  { value: 1000000, name: 'Tier 7' }
];

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

function cleanNumber(value) {
  return Number(String(value || '0').replace(/,/g, '')) || 0;
}

function createProgressBar(percent, size = 10) {
  const filled = Math.round((percent / 100) * size);
  const empty = size - filled;
  return '🟩'.repeat(filled) + '⬜'.repeat(empty);
}

function getTierProgress(currentDiamonds) {
  const current = cleanNumber(currentDiamonds);

  const nextTier = DIAMOND_TIERS.find(t => t.value > current);
  const previousTier = [...DIAMOND_TIERS].reverse().find(t => t.value <= current);

  if (!nextTier) {
    return {
      percent: 100,
      bar: createProgressBar(100),
      text: 'Max tier reached 🎉'
    };
  }

  const previousValue = previousTier ? previousTier.value : 0;
  const progress = ((current - previousValue) / (nextTier.value - previousValue)) * 100;

  return {
    percent: Math.floor(progress),
    bar: createProgressBar(progress),
    text: `${(nextTier.value - current).toLocaleString()} diamonds → ${nextTier.name} (${nextTier.value.toLocaleString()})`
  };
}

function getLiveProgress(days, hours) {
  const minDays = 12;
  const minHours = 25;
  const maxDays = 22;
  const maxHours = 80;

  const currentDays = cleanNumber(days);
  const currentHours = cleanNumber(hours);

  const daysPercent = Math.min((currentDays / maxDays) * 100, 100);
  const hoursPercent = Math.min((currentHours / maxHours) * 100, 100);

  const meetsMin = currentDays >= minDays && currentHours >= minHours;

  const daysLeft = Math.max(minDays - currentDays, 0);
  const hoursLeft = Math.max(minHours - currentHours, 0);

  const closeToMin =
    currentDays >= minDays * 0.8 &&
    currentHours >= minHours * 0.8;

  let statusIcon = '❌';
  let statusText = 'Below minimum';
  let color = 0xff0000;

  if (meetsMin) {
    statusIcon = '✅';
    statusText = 'Minimum reached';
    color = 0x00c853;
  } else if (closeToMin) {
    statusIcon = '⚠️';
    statusText = 'Close to minimum';
    color = 0xffa000;
  }

  let statusLine = `${statusIcon} ${statusText}`;

  if (!meetsMin) {
    statusLine += `\nNeeded: ${daysLeft} more day${daysLeft === 1 ? '' : 's'} / ${hoursLeft} more hour${hoursLeft === 1 ? '' : 's'}`;
  }

  return {
    daysBar: createProgressBar(daysPercent),
    hoursBar: createProgressBar(hoursPercent),
    daysPercent: Math.floor(daysPercent),
    hoursPercent: Math.floor(hoursPercent),
    text: `Min: ${minDays}d / ${minHours}h\nMax: ${maxDays}d / ${maxHours}h`,
    statusLine,
    color
  };
}

async function getUserDataById(discordId) {
  const res = await axios.get(SHEET_CSV_URL);

  const records = parse(res.data, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  for (const row of records) {
    if (row.discord_id && row.discord_id.trim() === discordId) {
      return row;
    }
  }

  return null;
}

function createUserEmbed(name, result) {
  const diamonds = cleanNumber(result['total diamonds']);
  const tierProgress = getTierProgress(diamonds);

  const live = getLiveProgress(
    result['valid go live days'],
    result['valid go live hrs']
  );

  return new EmbedBuilder()
    .setTitle(`👤 ${name}`)
    .setColor(live.color)
    .addFields(
      { name: 'Tier Status', value: result['tier status'] || 'N/A' },
      {
        name: '📊 Live Progress',
        value:
          `\`\`\`\nDays  : ${live.daysBar} ${live.daysPercent}%\nHours : ${live.hoursBar} ${live.hoursPercent}%\n\n${live.text}\n${live.statusLine}\`\`\``,
      },
      { name: '📅 Live Days', value: `\`\`\`${result['valid go live days'] || '0'}\`\`\``, inline: true },
      { name: '⏱️ Live Hours', value: `\`\`\`${result['valid go live hrs'] || '0'}\`\`\``, inline: true },
      { name: '\u200B', value: '\u200B', inline: true },
      { name: '💎 Diamonds', value: diamonds.toLocaleString(), inline: true },
      { name: '🎁 Activeness Reward in USD', value: result['reward'] || 'N/A', inline: true },
      {
        name: '⬆️ Next Tier Progress',
        value: `\`\`\`${tierProgress.bar} ${tierProgress.percent}%\n${tierProgress.text}\`\`\``,
      }
    )
    .setFooter({ text: 'User Lookup System' })
    .setTimestamp();
}

function createRefreshButton(discordId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`refresh_${discordId}`)
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Primary)
  );
}

client.once(Events.ClientReady, readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  logEvent('bot_ready', {
    bot_tag: readyClient.user.tag,
    bot_id: readyClient.user.id
  });
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {
    logEvent('command_used', {
      command: interaction.commandName,
      user_id: interaction.user.id,
      username: interaction.user.username,
      user_tag: interaction.user.tag,
      guild_id: interaction.guildId || null,
      channel_id: interaction.channelId || null
    });

    if (interaction.commandName !== 'username') return;

    await interaction.deferReply({ ephemeral: true });

    const discordId = interaction.user.id;
    const name = interaction.user.username;

    let result;

    try {
      result = await getUserDataById(discordId);

      logEvent('lookup_result', {
        user_id: discordId,
        username: name,
        found: Boolean(result)
      });
    } catch (error) {
      console.error('Google Sheet error:', error);

      logEvent('error', {
        area: 'google_sheet_lookup',
        user_id: discordId,
        username: name,
        message: error.message
      });

      await interaction.editReply('❌ I could not read the Google Sheet.');
      return;
    }

    if (!result) {
      logEvent('account_not_linked', {
        user_id: discordId,
        username: name
      });

      await interaction.editReply(
        `❌ Your account is not linked.\n\nSend this ID to an admin:\n\`${discordId}\``
      );
      return;
    }

    const embed = createUserEmbed(name, result);
    const row = createRefreshButton(discordId);

    try {
      await interaction.user.send({
        embeds: [embed],
        components: [row],
      });

      logEvent('dm_sent', {
        user_id: discordId,
        username: name
      });

      await interaction.editReply('📩 I sent you a DM!');
    } catch (error) {
      logEvent('dm_failed_showing_here', {
        user_id: discordId,
        username: name,
        message: error.message
      });

      await interaction.editReply({
        content: '❌ Could not DM you, showing here:',
        embeds: [embed],
        components: [row],
      });
    }
  }

  if (interaction.isButton()) {
    logEvent('button_clicked', {
      custom_id: interaction.customId,
      user_id: interaction.user.id,
      username: interaction.user.username,
      user_tag: interaction.user.tag,
      guild_id: interaction.guildId || null,
      channel_id: interaction.channelId || null
    });

    if (!interaction.customId.startsWith('refresh_')) return;

    const discordId = interaction.customId.replace('refresh_', '');

    if (interaction.user.id !== discordId) {
      logEvent('unauthorized_refresh_click', {
        button_owner_id: discordId,
        clicked_by_id: interaction.user.id,
        clicked_by_username: interaction.user.username
      });

      await interaction.reply({
        content: '❌ This button is not for you.',
        ephemeral: true
      });
      return;
    }

    await interaction.deferUpdate();

    try {
      const result = await getUserDataById(discordId);

      logEvent('refresh_lookup_result', {
        user_id: discordId,
        username: interaction.user.username,
        found: Boolean(result)
      });

      if (!result) return;

      const embed = createUserEmbed(interaction.user.username, result);
      const row = createRefreshButton(discordId);

      await interaction.editReply({
        embeds: [embed],
        components: [row],
      });

      logEvent('refresh_success', {
        user_id: discordId,
        username: interaction.user.username
      });
    } catch (error) {
      console.error('Refresh error:', error);

      logEvent('error', {
        area: 'refresh_button',
        user_id: discordId,
        username: interaction.user.username,
        message: error.message
      });
    }
  }
});

client.login(TOKEN);
