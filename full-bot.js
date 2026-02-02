const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const fs = require('fs');

const config = require('./config.json');
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const DATA_FILE = './data.json';
let data = {
  usedKeys: [],
  userModes: {},
  guilds: {},
  tickets: {},
  vouches: {},
  afk: {}
};

if (fs.existsSync(DATA_FILE)) {
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    console.error('Failed to load data.json:', err.message);
  }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to save data.json:', err.message);
  }
}

function isMiddlemanUser(userId) {
  return data.userModes[userId] && data.userModes[userId].mode === 'middleman';
}

function isTicketUser(userId) {
  return data.userModes[userId] && data.userModes[userId].mode === 'ticket';
}

client.once('ready', () => {
  console.log(`Bot online → ${client.user.tag} | ${client.guilds.cache.size} servers`);
});

async function askQuestion(channel, userId, question) {
  await channel.send(question);
  const filter = m => m.author.id === userId && !m.author.bot;
  const collector = channel.createMessageCollector({ filter, max: 1, time: 120_000 });
  return new Promise(resolve => {
    collector.on('collect', m => resolve(m.content.trim()));
    collector.on('end', (c, r) => {
      if (r === 'time') {
        channel.send('Timed out.');
        resolve(null);
      }
    });
  });
}

async function updateTicketPerms(channel, ticket, setup) {
  try {
    if (setup.middlemanRole) {
      await channel.permissionOverwrites.edit(setup.middlemanRole, {
        SendMessages: ticket.claimedBy ? false : null
      });
    }
    await channel.permissionOverwrites.edit(ticket.opener, { SendMessages: true });
    if (ticket.claimedBy) await channel.permissionOverwrites.edit(ticket.claimedBy, { SendMessages: true });
    ticket.addedUsers.forEach(uid => channel.permissionOverwrites.edit(uid, { SendMessages: true }).catch(() => {}));
    if (setup.hitterRole) await channel.permissionOverwrites.edit(setup.hitterRole, { SendMessages: true });
    if (setup.coOwnerRole) await channel.permissionOverwrites.edit(setup.coOwnerRole, { SendMessages: true });
  } catch (err) {
    console.error('Perm update error:', err.message);
  }
}

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  const userId = message.author.id;
  const guildId = message.guild.id;
  if (!data.guilds[guildId]) data.guilds[guildId] = { setup: {} };
  const setup = data.guilds[guildId].setup;
  const userMode = data.userModes[userId];

  if (data.afk[userId]) {
    delete data.afk[userId];
    saveData();
    try {
      const member = message.member;
      await member.setNickname(member.displayName.replace(/^\[AFK\] /, ''));
      message.channel.send(`**${message.author} is back from AFK!**`);
    } catch (err) {
      console.error('AFK remove error:', err.message);
    }
  }

  const mentions = message.mentions.users;
  if (mentions.size > 0) {
    for (const [afkId, afkData] of Object.entries(data.afk)) {
      if (mentions.has(afkId)) {
        await message.delete().catch(() => {});
        const time = Math.round((Date.now() - afkData.afkSince) / 60000);
        return message.channel.send(
          `**${client.users.cache.get(afkId)?.tag || 'User'} is AFK**\n` +
          `**Reason:** ${afkData.reason}\n` +
          `**Since:** ${time} minutes ago\n(Ping deleted)`
        );
      }
    }
  }

  if (!message.content.startsWith(config.prefix)) {
    if (userMode && userMode.mode === null) {
      const content = message.content.trim().toLowerCase();
      if (content === '1' || content === 'ticket') {
        userMode.mode = 'ticket';
        saveData();
        return message.reply('**Ticket mode activated!** Use $shazam to setup.');
      }
      if (content === '2' || content === 'middleman') {
        userMode.mode = 'middleman';
        saveData();
        return message.reply('**Middleman mode activated!** Use $schior.');
      }
    }
    return;
  }

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  if (cmd === 'help') {
    const isMiddle = isMiddlemanUser(userId);
    const isTicket = isTicketUser(userId);

    const embed = new EmbedBuilder()
      .setColor(0x0088ff)
      .setTitle('Bot Commands - $help')
      .setDescription('Available commands based on your mode.');

    embed.addFields({
      name: '🛡️ Middleman Commands (middleman mode only)',
      value: 
        '` $schior ` → Recruitment embed + Join/Not Interested buttons\n' +
        '` $mmfee ` → Fee choice embed\n' +
        '` $confirm ` → Trade confirm embed\n' +
        '` $vouch @user ` → +1 vouch\n' +
        '` $vouches [@user] ` → Check vouches\n' +
        '` $afk [reason] ` → Set AFK\n' +
        (isMiddle ? '✅ You have access.' : '🔒 Redeem key + choose 2 to unlock.')
    });

    embed.addFields({
      name: '🎫 Ticket Commands (ticket mode only)',
      value: 
        '` $ticket1 ` → Post ticket panel\n' +
        '` $claim ` → Claim ticket\n' +
        '` $unclaim ` → Unclaim\n' +
        '` $close ` → Close + transcript\n' +
        '` $add @user ` → Add user\n' +
        '` $transfer @user ` → Transfer claim\n' +
        (isTicket ? '✅ You have access.' : '🔒 Redeem key + choose 1 to unlock.')
    });

    embed.addFields({
      name: '🌐 General Commands',
      value: 
        '` $redeem <key> ` → Redeem key\n' +
        '` $help ` → This command\n' +
        '` $vouches [@user] ` → Check vouches\n' +
        '` $afk [reason] ` → Set AFK\n' +
        (message.author.id === config.ownerId ? '` $dm <msg> ` → Mass DM (owner only)' : '')
    });

    embed.setFooter({ text: 'Redeem a key to unlock mode-specific commands' });

    return message.channel.send({ embeds: [embed] });
  }

  if (cmd === 'redeem') {
    if (!args[0]) return message.reply('Usage: $redeem <key>');
    const key = args[0];
    if (!config.validKeys[key]) return message.reply('Invalid key.');
    if (data.usedKeys.includes(key)) return message.reply('Key already used.');
    const type = config.validKeys[key];
    data.usedKeys.push(key);
    data.userModes[userId] = { mode: null, type, redeemDate: Date.now() };
    saveData();

    message.reply(`**${type} key activated!**\nReply with **1** (Ticket) or **2** (Middleman)`);

    try {
      await message.author.send(
        `**You have redeemed a ${type} key!**\n\n` +
        `**Tutorial:**\n` +
        `1. Go to a channel for tickets/category.\n` +
        `2. Type **$shazam** and answer questions.\n` +
        `3. Use **$ticket1** (ticket mode) or **$schior** (middleman mode).\n\n` +
        `Good luck!`
      );
    } catch {
      message.reply('DM failed (closed?). Check reply above.');
    }
  }

  if (userMode && userMode.mode === null) {
    const content = message.content.trim().toLowerCase();
    if (content === '1' || content === 'ticket') {
      userMode.mode = 'ticket';
      saveData();
      return message.reply('**Ticket mode activated!** Use $shazam to setup.');
    }
    if (content === '2' || content === 'middleman') {
      userMode.mode = 'middleman';
      saveData();
      return message.reply('**Middleman mode activated!** Use $schior.');
    }
  }

  if (cmd === 'shazam') {
    if (!userMode || userMode.mode === null) return message.reply('Redeem & choose mode first.');
    await message.reply('Setup started. Answer each question. Type "cancel" to stop.');

    let ans;
    ans = await askQuestion(message.channel, userId, 'Ticket transcripts channel ID:');
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.transcriptsChannel = ans;

    ans = await askQuestion(message.channel, userId, 'Middleman role ID:');
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.middlemanRole = ans;

    ans = await askQuestion(message.channel, userId, 'Hitter role ID:');
    if (!ans || ans.toLowerCase() === 'cancel') return
