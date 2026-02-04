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

// Load configuration
let config;
try {
  config = require('./config.json');
} catch (e) {
  config = {
    prefix: '$',
    validKeys: { 'KEY-123': 'Premium', 'KEY-456': 'Basic' }
  };
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const BOT_OWNER_ID = process.env.BOT_OWNER_ID || 'YOUR_OWNER_ID_HERE';

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
    console.log('[DATA] Loaded');
  } catch (err) {
    console.error('[DATA] Load failed:', err);
  }
}

function saveData() {
  try {
    const serial = { ...data, redeemedUsers: Array.from(data.redeemedUsers) };
    fs.writeFileSync(DATA_FILE, JSON.stringify(serial, null, 2));
  } catch (err) {
    console.error('[DATA] Save failed:', err);
  }
}

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
        m.reply('Invalid input.');
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
    const overwrites = [
      { id: channel.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: ticket.opener, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
    ];

    if (setup.coOwnerRole) {
      overwrites.push({
        id: setup.coOwnerRole,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
      });
    }

    if (!ticket.isSellerTicket && !ticket.isShopTicket) {
      if (setup.middlemanRole) {
        overwrites.push({
          id: setup.middlemanRole,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
          deny: ticket.claimedBy ? [] : [PermissionsBitField.Flags.SendMessages]
        });
      }
      if (setup.indexMiddlemanRole) {
        overwrites.push({
          id: setup.indexMiddlemanRole,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
          deny: ticket.claimedBy ? [] : [PermissionsBitField.Flags.SendMessages]
        });
      }
    }

    if (ticket.claimedBy) {
      overwrites.push({
        id: ticket.claimedBy,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
      });
    }

    ticket.addedUsers.forEach(uid => {
      overwrites.push({
        id: uid,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
      });
    });

    await channel.permissionOverwrites.set(overwrites);
  } catch (err) {
    console.error('Perms error:', err);
  }
}

client.once('ready', () => console.log(`[READY] ${client.user.tag} online`));

// Message Handler
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;
  const userId = message.author.id;
  const guildId = message.guild.id;
  if (!data.guilds[guildId]) data.guilds[guildId] = { setup: {} };
  const setup = data.guilds[guildId].setup;
  if (!data.userModes[userId]) data.userModes[userId] = { ticket: false, middleman: false };

  // Redeem reply logic
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
      return message.reply('**Middleman mode activated!** Use $shazam1.');
    }
    return message.reply('Reply **1** or **2** only.');
  }

  if (!message.content.startsWith(config.prefix)) return;

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  // Redeem Command
  if (cmd === 'redeem') {
    const key = args[0];
    if (!key || !config.validKeys[key]) return message.reply('Invalid key.');
    if (data.usedKeys.includes(key)) return message.reply('Key already used.');
    data.usedKeys.push(key);
    data.redeemedUsers.add(userId);
    data.redeemPending[userId] = true;
    saveData();
    return message.reply('**Key activated!** Reply **1** (Ticket) or **2** (Middleman).');
  }

  // Middleman commands
  if (['schior','mmfee','mminfo','vouches','vouch','setvouches'].includes(cmd)) {
    const mm = setup.middlemanRole ? String(setup.middlemanRole) : null;
    const imm = setup.indexMiddlemanRole ? String(setup.indexMiddlemanRole) : null;
    if (!mm && !imm) return message.reply('No middleman roles configured. Run $shazam1.');
    const hasMM = mm && message.member.roles.cache.has(mm);
    const hasIMM = imm && message.member.roles.cache.has(imm);
    if (!hasMM && !hasIMM) return message.reply('You need the middleman role.');

    if (cmd === 'vouches') {
      const target = message.mentions.users.first() || client.users.cache.get(args[0]) || message.author;
      return message.reply(`${target.tag} has **${data.vouches[target.id] || 0}** vouches.`);
    }
    if (cmd === 'vouch') {
      const target = message.mentions.users.first() || client.users.cache.get(args[0]);
      if (!target || target.id === message.author.id) return message.reply('Invalid user.');
      data.vouches[target.id] = (data.vouches[target.id] || 0) + 1;
      saveData();
      return message.reply(`✅ Vouched for ${target.tag}!`);
    }
    if (cmd === 'setvouches') {
      if (message.author.id !== BOT_OWNER_ID) return message.reply('Owner only.');
      const target = message.mentions.users.first() || client.users.cache.get(args[0]);
      const amount = parseInt(args[1]);
      if (!target || isNaN(amount)) return message.reply('Usage: $setvouches @user <number>');
      data.vouches[target.id] = amount;
      saveData();
      return message.reply(`Set vouches to ${amount}.`);
    }
    if (cmd === 'mmfee') return message.reply('Fee: 5% or fixed rates. Open ticket for details.');
    if (cmd === 'mminfo') return message.reply('Safe trading service. Open ticket to start.');
    if (cmd === 'schior') return message.reply('Schior System: Online.');
  }

  // Ticket setup commands and panels
  if (cmd === 'shazam' || cmd === 'shazam1') {
    if (!isRedeemed(userId)) return message.reply('Redeem first.');
    if (cmd === 'shazam') {
      setup.transcriptsChannel = await askQuestion(message.channel, userId, 'Transcript Channel ID:');
      setup.middlemanRole = await askQuestion(message.channel, userId, 'MM Role ID:');
      setup.indexMiddlemanRole = await askQuestion(message.channel, userId, 'Index MM Role ID:');
      setup.coOwnerRole = await askQuestion(message.channel, userId, 'Co-Owner Role ID:');
      setup.ticketCategory = await askQuestion(message.channel, userId, 'Ticket Category ID:');
      saveData();
      return message.reply('Ticket setup complete.');
    } else {
      setup.middlemanRole = await askQuestion(message.channel, userId, 'MM Role ID:');
      setup.indexMiddlemanRole = await askQuestion(message.channel, userId, 'Index MM Role ID:');
      saveData();
      return message.reply('Middleman setup complete.');
    }
  }

  // Ticket panel buttons
  if (['ticket1','index','seller','shop'].includes(cmd)) {
    if (!isRedeemed(userId)) return message.reply('Redeem first.');
    const embed = new EmbedBuilder().setTitle('Open Ticket').setDescription('Click below to create a ticket.');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`request_${cmd === 'ticket1' ? 'ticket' : cmd}`).setLabel('Open Ticket').setStyle(ButtonStyle.Primary)
    );
    return message.channel.send({ embeds: [embed], components: [row] });
  }

  // Ticket channel commands
  const ticket = data.tickets[message.channel.id];
  if (ticket) {
    const isMM = setup.middlemanRole && message.member.roles.cache.has(setup.middlemanRole);
    const isIMM = setup.indexMiddlemanRole && message.member.roles.cache.has(setup.indexMiddlemanRole);
    const isCo = setup.coOwnerRole && message.member.roles.cache.has(setup.coOwnerRole);
    const isOwner = message.author.id === BOT_OWNER_ID;
    const canManage = isMM || isIMM || isCo || isOwner;

    if (cmd === 'claim') {
      if (!canManage) return message.reply('Only staff can claim.');
      if (ticket.claimedBy) return message.reply('Already claimed.');
      ticket.claimedBy = message.author.id;
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      return message.reply(`Claimed by ${message.author}`);
    }
    if (cmd === 'unclaim') {
      if (!canManage) return message.reply('Only staff can unclaim.');
      ticket.claimedBy = null;
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      return message.reply('Ticket unclaimed.');
    }
    if (cmd === 'close') {
      if (!canManage) return message.reply('Only staff can close.');
      const msgs = await message.channel.messages.fetch({ limit: 100 });
      const transcript = msgs.reverse().map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || '[Embed/Media]'}`).join('\n');
      const tChan = message.guild.channels.cache.get(setup.transcriptsChannel);
      if (tChan) tChan.send({ content: `Transcript for ${message.channel.name}`, files: [{ attachment: Buffer.from(transcript, 'utf-8'), name: `${message.channel.name}.txt` }] });
      await message.channel.delete();
    }
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return;
  const setup = data.guilds[interaction.guild.id]?.setup || {};

  // Modal submit for tickets
  if (interaction.isButton() && interaction.customId.startsWith('request_')) {
    const modalType = interaction.customId.replace('request_', '');
    const modal = new ModalBuilder().setCustomId(`${modalType}_modal`).setTitle('Ticket Form');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel('Details').setStyle(TextInputStyle.Paragraph)));
    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit()) {
    const type = interaction.customId.replace('_modal','');
    const channel = await interaction.guild.channels.create({ name: `${type}-${interaction.user.username}`, type: ChannelType.GuildText, parent: setup.ticketCategory });
    data.tickets[channel.id] = { opener: interaction.user.id, claimedBy: null, addedUsers: [], isIndexTicket: type === 'index', isSellerTicket: type === 'seller', isShopTicket: type === 'shop' };
    saveData();
    await updateTicketPerms(channel, data.tickets[channel.id], setup);
    const row = new ActionRowBuilder()
      .addComponents(new ButtonBuilder().setCustomId(type === 'index' ? 'claim_index_ticket' : 'claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success))
      .addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Secondary));
    await channel.send({ content: `Ticket opened by ${interaction.user}`, components: [row] });
    return interaction.reply({ content: `Ticket created: ${channel}`, ephemeral: true });
  }

  if (interaction.isButton()) {
    const ticket = data.tickets[interaction.channel.id];
    if (!ticket) return;
    if (interaction.customId === 'close_ticket') return interaction.channel.delete();
    if (interaction.customId.startsWith('claim')) {
      if (ticket.claimedBy) return interaction.reply({ content: 'Already claimed.', ephemeral: true });
      ticket.claimedBy = interaction.user.id;
      saveData();
      await updateTicketPerms(interaction.channel, ticket, setup);
      const row = new ActionRowBuilder()
        .addComponents(new ButtonBuilder().setCustomId('unclaim_ticket').setLabel('Unclaim').setStyle(ButtonStyle.Danger))
        .addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Secondary));
      return interaction.update({ content: `Claimed by ${interaction.user}`, components: [row] });
    }
    if (interaction.customId === 'unclaim_ticket') {
      ticket.claimedBy = null;
      saveData();
      await updateTicketPerms(interaction.channel, ticket, setup);
      const row = new ActionRowBuilder()
        .addComponents(new ButtonBuilder().setCustomId(ticket.isIndexTicket ? 'claim_index_ticket' : 'claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success))
        .addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Secondary));
      return interaction.update({ content: 'Ticket unclaimed.', components: [row] });
    }
  }
});

client.login(process.env.TOKEN);
