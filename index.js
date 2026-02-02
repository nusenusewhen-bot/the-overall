const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField
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
  redeemedUsers: new Set(),
  userModes: {},
  redeemPending: {},
  guilds: {},
  tickets: {},
  vouches: {},
  afk: {}
};

// Load data
if (fs.existsSync(DATA_FILE)) {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const loaded = JSON.parse(raw);
    data.usedKeys = loaded.usedKeys || [];
    data.redeemedUsers = new Set(loaded.redeemedUsers || []);
    data.userModes = loaded.userModes || {};
    data.redeemPending = loaded.redeemPending || {};
    data.guilds = loaded.guilds || {};
    data.tickets = loaded.tickets || {};
    data.vouches = loaded.vouches || {};
    data.afk = loaded.afk || {};
    console.log('[DATA] Loaded successfully');
  } catch (err) {
    console.error('[DATA] Load failed:', err.message);
  }
}

// Save function
function saveData() {
  try {
    const serial = { ...data, redeemedUsers: Array.from(data.redeemedUsers) };
    fs.writeFileSync(DATA_FILE, JSON.stringify(serial, null, 2));
    console.log('[DATA] Saved');
  } catch (err) {
    console.error('[DATA] Save failed:', err.message);
  }
}

// Helpers
function hasTicketMode(userId) { return data.userModes[userId]?.ticket === true; }
function hasMiddlemanMode(userId) { return data.userModes[userId]?.middleman === true; }
function isRedeemed(userId) { return data.redeemedUsers.has(userId); }

async function askQuestion(channel, userId, question, validator = null) {
  await channel.send(question);
  const filter = m => m.author.id === userId && !m.author.bot;
  const collector = channel.createMessageCollector({ filter, max: 1, time: 180000 });
  return new Promise(resolve => {
    collector.on('collect', m => {
      const ans = m.content.trim();
      if (validator && !validator(ans)) {
        m.reply('Invalid — numbers only for IDs.');
        collector.resetTimer();
        return;
      }
      resolve(ans);
    });
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
    await channel.permissionOverwrites.edit(channel.guild.id, { ViewChannel: false, SendMessages: false });

    await channel.permissionOverwrites.edit(ticket.opener, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    });

    if (setup.middlemanRole) {
      await channel.permissionOverwrites.edit(setup.middlemanRole, {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: ticket.claimedBy ? false : true
      });
    }

    if (ticket.claimedBy) {
      await channel.permissionOverwrites.edit(ticket.claimedBy, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      });
    }

    ticket.addedUsers.forEach(uid => {
      channel.permissionOverwrites.edit(uid, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      }).catch(() => {});
    });

    if (setup.coOwnerRole) {
      await channel.permissionOverwrites.edit(setup.coOwnerRole, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      });
    }
  } catch (err) {
    console.error('Perms error:', err);
  }
}

// Ready
client.once('ready', () => {
  console.log(`[READY] ${client.user.tag} online`);
});

// Messages
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  const userId = message.author.id;
  const guildId = message.guild.id;
  if (!data.guilds[guildId]) data.guilds[guildId] = { setup: {} };
  const setup = data.guilds[guildId].setup;

  if (!data.userModes[userId]) data.userModes[userId] = { ticket: false, middleman: false };

  // AFK remove
  if (data.afk[userId]) {
    delete data.afk[userId];
    saveData();
    try {
      await message.member.setNickname(message.member.displayName.replace(/^\[AFK\] /, ''));
      message.channel.send(`**${message.author} is back!**`);
    } catch {
      message.channel.send(`**AFK cleared** (nickname failed)`);
    }
  }

  // AFK ping block
  const mentions = message.mentions.users;
  if (mentions.size > 0) {
    for (const [afkId, afkData] of Object.entries(data.afk)) {
      if (mentions.has(afkId)) {
        await message.delete().catch(() => {});
        const time = Math.round((Date.now() - afkData.afkSince) / 60000);
        return message.channel.send(
          `**${client.users.cache.get(afkId)?.tag || 'User'} is AFK**\n` +
          `**Reason:** ${afkData.reason}\n` +
          `**Since:** ${time} min ago\n(Ping deleted)`
        );
      }
    }
  }

  // Redeem reply - only redeemer
  if (!message.content.startsWith(config.prefix) && data.redeemPending[userId]) {
    const content = message.content.trim().toLowerCase();

    if (content === '1' || content === 'ticket') {
      data.userModes[userId].ticket = true;
      delete data.redeemPending[userId];
      saveData();
      return message.reply('**Ticket mode activated!** Use $shazam.');
    }

    if (content === '2' || content === 'middleman') {
      data.userModes[userId].middleman = true;
      delete data.redeemPending[userId];
      saveData();
      message.reply('**Middleman mode activated!** Use $schior.');
      // Setup roles etc.
      const roleId = await askQuestion(message.channel, userId, 'Middleman role ID (numbers only):', ans => /^\d+$/.test(ans));
      if (roleId) setup.middlemanRole = roleId;
      const hitterId = await askQuestion(message.channel, userId, 'Hitter role ID (numbers only):', ans => /^\d+$/.test(ans));
      if (hitterId) setup.hitterRole = hitterId;
      const welcomeId = await askQuestion(message.channel, userId, 'Welcome channel ID (numbers only):', ans => /^\d+$/.test(ans));
      if (welcomeId) setup.welcomeHitterChannel = welcomeId;
      saveData();
      return;
    }

    return message.reply('Reply **1** or **2** only.');
  }

  if (!message.content.startsWith(config.prefix)) return;

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  // Redeem
  if (cmd === 'redeem') {
    if (!args[0]) return message.reply('Usage: $redeem <key>');
    const key = args[0];
    if (!config.validKeys[key]) return message.reply('Invalid key.');
    if (data.usedKeys.includes(key)) return message.reply('Key used.');

    const type = config.validKeys[key];
    data.usedKeys.push(key);
    data.redeemedUsers.add(userId);
    data.redeemPending[userId] = true;
    saveData();
    message.reply(`**${type} key activated!** Reply **1** (Ticket) or **2** (Middleman)`);
    try { await message.author.send(`**Redeemed ${type}!** Reply **1** or **2** in channel.`); } catch {}
    return;
  }

  // Shazam setup
  if (cmd === 'shazam') {
    if (!isRedeemed(userId) || !hasTicketMode(userId)) return;
    await message.reply('**Setup started.** Answer questions. "cancel" to stop.');
    let ans;
    ans = await askQuestion(message.channel, userId, 'Transcripts channel ID (numbers):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.transcriptsChannel = ans;
    ans = await askQuestion(message.channel, userId, 'Middleman role ID (numbers):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.middlemanRole = ans;
    ans = await askQuestion(message.channel, userId, 'Hitter role ID (numbers):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.hitterRole = ans;
    // Verification link
    while (true) {
      ans = await askQuestion(message.channel, userId, 'Verification link (https://...)');
      if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Cancelled.');
      if (ans.startsWith('https://')) { setup.verificationLink = ans; break; }
      await message.channel.send('Must start with https://.');
    }
    ans = await askQuestion(message.channel, userId, 'Guide channel ID (numbers):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.guideChannel = ans;
    ans = await askQuestion(message.channel, userId, 'Co-owner role ID (numbers):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.coOwnerRole = ans;
    saveData();
    message.channel.send('**Setup complete!** Use $ticket1.');
  }

  // Ticket panel
  if (cmd === 'ticket1') {
    if (!hasTicketMode(userId)) return message.reply('Ticket mode required.');
    const embed = new EmbedBuilder()
      .setColor(0x0088ff)
      .setDescription(
        `Found a trade and would like to ensure a safe trading experience?

**Open a ticket below**

**What we provide**
• We provide safe traders between 2 parties
• We provide fast and easy deals

**Important notes**
• Both parties must agree before opening a ticket
• Fake/Troll tickets will result into a ban or ticket blacklist
• Follow discord Terms of service and server guidelines`
      )
      .setImage('https://i.postimg.cc/8D3YLBgX/ezgif-4b693c75629087.gif')
      .setFooter({ text: 'Safe Trading Server' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('request_ticket')
        .setLabel('Request')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📩')
    );

    await message.channel.send({ embeds: [embed], components: [row] });
  }
});

// Interactions
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  const setup = data.guilds[interaction.guild.id]?.setup || {};

  // Ticket request
  if (interaction.customId === 'request_ticket') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const ticketChannel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: 0,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
        ]
      });
      data.tickets[ticketChannel.id] = { opener: interaction.user.id, claimedBy: null, addedUsers: [] };
      saveData();
      await interaction.editReply({ content: `✅ Ticket created: ${ticketChannel}` });
    } catch (err) {
      console.error(err);
      await interaction.editReply({ content: '❌ Failed to create ticket.' });
    }
    return;
  }

  // Middleman buttons
  if (interaction.customId === 'join_hitter') {
    const member = interaction.member;
    if (!member.roles.cache.has(setup.hitterRole) && setup.hitterRole) await member.roles.add(setup.hitterRole);
    const welcomeChan = interaction.guild.channels.cache.get(setup.welcomeHitterChannel);
    if (welcomeChan) {
      await welcomeChan.send(`**${interaction.user} has became a hitter**, welcome!`);
    }
    await interaction.reply({ content: 'Joined! Check welcome channel.', ephemeral: true });
  }

  if (interaction.customId === 'not_interested_hitter') {
    await interaction.channel.send(`**${interaction.user} was not interested**, click Join Us if you change your mind.`);
  }

  if (interaction.customId === 'understood_mm') {
    await interaction.channel.send(`**${interaction.user} Got it!** You're ready to use the middleman service.`);
  }

  if (interaction.customId === 'didnt_understand_mm') {
    await interaction.channel.send(`**${interaction.user}** No worries! Ask staff or read guide.`);
  }
});

client.login(process.env.DISCORD_TOKEN);
