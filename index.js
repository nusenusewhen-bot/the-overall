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

  // AFK auto-remove
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

  // Block AFK pings
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

  if (!message.content.startsWith(config.prefix)) return;

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  // $help
  if (cmd === 'help') {
    const isMiddle = isMiddlemanUser(userId);
    const isTicket = isTicketUser(userId);

    const embed = new EmbedBuilder()
      .setColor(0x0088ff)
      .setTitle('Bot Commands - $help')
      .setDescription('Available commands based on your mode.');

    embed.addFields({
      name: '🛡️ Middleman Commands (requires middleman mode)',
      value: 
        '` $schior ` → Recruitment embed + Join/Not Interested buttons\n' +
        '` $mmfee ` → Fee choice embed (50%/100%)\n' +
        '` $confirm ` → Trade confirmation embed\n' +
        '` $vouch @user ` → +1 vouch (in ticket channels)\n' +
        '` $vouches [@user] ` → Check vouches\n' +
        '` $afk [reason] ` → Set AFK status\n' +
        (isMiddle ? '✅ You have access.' : '🔒 Redeem key + choose 2 to unlock.')
    });

    embed.addFields({
      name: '🎫 Ticket Commands (requires ticket mode)',
      value: 
        '` $ticket1 ` → Post ticket panel\n' +
        '` $claim ` → Claim ticket\n' +
        '` $unclaim ` → Unclaim ticket\n' +
        '` $close ` → Close ticket + transcript\n' +
        '` $add @user ` → Add user to ticket\n' +
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

  // Redeem
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

  // Mode choice
  if (userMode && userMode.mode === null) {
    const c = message.content.trim();
    if (c === '1' || c === '2') {
      userMode.mode = c === '1' ? 'ticket' : 'middleman';
      saveData();
      return message.reply(`**${userMode.mode} mode activated!**`);
    }
  }

  // Shazam setup
  if (cmd === 'shazam') {
    if (!userMode || userMode.mode === null) return message.reply('Redeem & choose mode first.');
    // ... (full shazam setup code - copy from earlier messages) ...
  }

  // Ticket panel
  if (cmd === 'ticket1') {
    if (!isTicketUser(userId)) return message.reply('Ticket mode required.');
    // ... (full ticket1 panel code with banner URL) ...
  }

  const ticket = data.tickets[message.channel.id];
  if (ticket) {
    const isMM = message.member.roles.cache.has(setup.middlemanRole);
    const isClaimed = message.author.id === ticket.claimedBy;
    const isCo = message.member.roles.cache.has(setup.coOwnerRole);
    const canManage = isMM || isClaimed || isCo;

    // Middleman commands restriction
    if (['mmfee', 'confirm', 'vouch', 'schior'].includes(cmd) && !isMiddlemanUser(userId)) {
      return message.reply('Middleman mode required.');
    }

    // ... all ticket commands ($add, $transfer, $close, $claim, $unclaim, $mmfee, $confirm, $vouch) ...
  }

  // Middleman recruitment
  if (cmd === 'schior') {
    if (!isMiddlemanUser(userId)) return message.reply('Middleman mode required.');
    // ... full $schior embed + buttons + kick logic ...
  }

  // Vouches
  if (cmd === 'vouches') {
    let targetId = userId;
    if (message.mentions.users.size) targetId = message.mentions.users.first().id;
    const count = data.vouches[targetId] || 0;
    const target = client.users.cache.get(targetId);
    return message.reply(targetId === userId ? `Your vouches: **${count}**` : `**${target?.tag || 'User'}** vouches: **${count}**`);
  }

  if (cmd === 'setvouches') {
    if (!message.member.roles.cache.has(setup.coOwnerRole) && message.author.id !== config.ownerId) {
      return message.reply('Co-owner or bot owner only.');
    }
    const target = message.mentions.users.first();
    if (!target) return message.reply('Usage: $setvouches @user number');
    const num = parseInt(args[1] || args[0]);
    if (isNaN(num) || num < 0) return message.reply('Valid number required.');
    data.vouches[target.id] = num;
    saveData();
    return message.reply(`**${target.tag}** vouches set to **${num}**.`);
  }

  if (cmd === 'vouch') {
    const target = message.mentions.users.first();
    if (!target) return message.reply('Usage: $vouch @user');
    data.vouches[target.id] = (data.vouches[target.id] || 0) + 1;
    saveData();
    return message.channel.send(`+1 vouch for **${target.tag}** → **${data.vouches[target.id]}**`);
  }

  // $dm (owner only)
  if (cmd === 'dm') {
    if (message.author.id !== config.ownerId) return message.reply('Bot owner only.');
    const msg = args.join(' ');
    if (!msg) return message.reply('Usage: $dm <message>');
    let sent = 0, failed = 0;
    for (const uid in data.userModes) {
      try {
        const u = await client.users.fetch(uid);
        await u.send(msg);
        sent++;
      } catch {
        failed++;
      }
    }
    return message.reply(`Sent to ${sent} users. Failed: ${failed}`);
  }

  // $afk [reason]
  if (cmd === 'afk') {
    const reason = args.join(' ') || 'AFK';
    data.afk[userId] = { reason, afkSince: Date.now() };
    saveData();

    try {
      await message.member.setNickname(`[AFK] ${message.member.displayName}`);
      await message.reply(`AFK set.\n**Reason:** ${reason}`);
    } catch {
      await message.reply(`AFK set (nickname failed). Reason: ${reason}`);
    }
  }
});

// interactionCreate (modals + buttons)
// ... (keep all your previous modal submit, ticket buttons, schior buttons, etc. code here) ...

client.login(process.env.DISCORD_TOKEN);
