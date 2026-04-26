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

async function getUserData(username) {
  const res = await axios.get(SHEET_CSV_URL);

  const records = parse(res.data, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const searchName = username.trim().toLowerCase();

  for (const row of records) {
    if (row.username && row.username.trim().toLowerCase() === searchName) {
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
      {
        name: 'Tier Status',
        value: result['tier status'] || 'N/A',
        inline: false,
      },

      {
        name: '📊 Live Progress',
        value:
          `\`\`\`\nDays  : ${live.daysBar} ${live.daysPercent}%\nHours : ${live.hoursBar} ${live.hoursPercent}%\n\n${live.text}\n${live.statusLine}\`\`\``,
        inline: false,
      },

      {
        name: '📅 Live Days',
        value: `\`\`\`${result['valid go live days'] || '0'}\`\`\``,
        inline: true,
      },
      {
        name: '⏱️ Live Hours',
        value: `\`\`\`${result['valid go live hrs'] || '0'}\`\`\``,
        inline: true,
      },

      { name: '\u200B', value: '\u200B', inline: true },

      {
        name: '💎 Diamonds',
        value: diamonds.toLocaleString(),
        inline: true,
      },
      {
        name: '🎁 Reward',
        value: result['reward'] || 'N/A',
        inline: true,
      },

      {
        name: '⬆️ Next Tier Progress',
        value: `\`\`\`${tierProgress.bar} ${tierProgress.percent}%\n${tierProgress.text}\`\`\``,
        inline: false,
      }
    )
    .setFooter({ text: 'User Lookup System' })
    .setTimestamp();
}

function createRefreshButton(name) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`refresh_${name}`)
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Primary)
  );
}

client.once(Events.ClientReady, readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName !== 'username') return;

    await interaction.deferReply({ ephemeral: true });

    const name = interaction.options.getString('name');

    let result;

    try {
      result = await getUserData(name);
    } catch (error) {
      console.error('Google Sheet error:', error);
      await interaction.editReply('❌ I could not read the Google Sheet.');
      return;
    }

    if (!result) {
      await interaction.editReply(`No result found for **${name}**.`);
      return;
    }

    const embed = createUserEmbed(name, result);
    const row = createRefreshButton(name);

    try {
      await interaction.user.send({
        embeds: [embed],
        components: [row],
      });

      await interaction.editReply('📩 I sent you a DM!');
    } catch (error) {
      console.error('DM error:', error);

      await interaction.editReply({
        content: '❌ I could not send you a DM. Here is your result instead:',
        embeds: [embed],
        components: [row],
      });
    }
  }

  if (interaction.isButton()) {
    if (!interaction.customId.startsWith('refresh_')) return;

    const name = interaction.customId.replace('refresh_', '');

    await interaction.deferUpdate();

    try {
      const result = await getUserData(name);

      if (!result) return;

      const embed = createUserEmbed(name, result);
      const row = createRefreshButton(name);

      await interaction.editReply({
        embeds: [embed],
        components: [row],
      });
    } catch (error) {
      console.error('Refresh error:', error);
    }
  }
});

client.login(TOKEN);