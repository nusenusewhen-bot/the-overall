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
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
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

const BOT_OWNER_ID = '1298640383688970293';

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
    console.error('[SAVE ERROR]', err);
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
        m.reply('Invalid — numbers only.');
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

    if (setup.coOwnerRole) {
      await channel.permissionOverwrites.edit(setup.coOwnerRole, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      });
    }

    if ((ticket.isReportTicket || ticket.isSupportTicket) && setup.staffRole) {
      await channel.permissionOverwrites.edit(setup.staffRole, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      });
    }

    if (!ticket.isSellerTicket && !ticket.isShopTicket && !ticket.isReportTicket && !ticket.isSupportTicket) {
      if (setup.middlemanRole) {
        await channel.permissionOverwrites.edit(setup.middlemanRole, {
          ViewChannel: true,
          ReadMessageHistory: true,
          SendMessages: ticket.claimedBy ? false : true
        });
      }

      if (setup.indexMiddlemanRole) {
        await channel.permissionOverwrites.edit(setup.indexMiddlemanRole, {
          ViewChannel: true,
          ReadMessageHistory: true,
          SendMessages: ticket.claimedBy ? false : true
        });
      }
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
  } catch (err) {
    console.error('[PERMS UPDATE ERROR]', err.message || err);
  }
}

client.once('ready', () => {
  console.log(`[READY] ${client.user.tag} online`);
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  const userId = message.author.id;
  const guildId = message.guild.id;
  if (!data.guilds[guildId]) data.guilds[guildId] = { setup: {} };
  const setup = data.guilds[guildId].setup;

  if (!data.userModes[userId]) data.userModes[userId] = { ticket: false, middleman: false };

  // Redeem reply (non-prefix)
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
      return message.reply('**Middleman mode activated!** Now run **$shazam1**.');
    }

    return message.reply('Reply **1** (Ticket) or **2** (Middleman) only.');
  }

  if (!message.content.startsWith(config.prefix)) return;

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  // Redeem
  if (cmd === 'redeem') {
    if (!args[0]) return message.reply('Usage: $redeem <key>');
    const key = args[0];
    if (!config.validKeys[key]) return message.reply('Invalid key.');
    if (data.usedKeys.includes(key)) return message.reply('Key already used.');

    const type = config.validKeys[key];
    data.usedKeys.push(key);
    data.redeemedUsers.add(userId);
    data.redeemPending[userId] = true;
    saveData();

    message.reply(`**Key activated!**\nReply **1** (Ticket mode) or **2** (Middleman mode) now.`);
    try { await message.author.send(`**Key redeemed!**\nReply **1** or **2** in channel.`); } catch {}
    return;
  }

  // Commands that require redeem only
  const redeemRequiredCommands = ['ticket1', 'index', 'seller', 'shop', 'support'];

  if (redeemRequiredCommands.includes(cmd)) {
    if (!isRedeemed(userId)) {
      return message.reply('You must redeem a key first.');
    }
  }

  // Middleman commands — require redeem + middleman mode
  if (['earn', 'mmfee', 'mminfo', 'vouches', 'vouch', 'setvouches'].includes(cmd)) {
    if (!isRedeemed(userId) || !hasMiddlemanMode(userId)) return; // silent ignore

    const hasMM = setup.middlemanRole && message.member.roles.cache.has(String(setup.middlemanRole));
    const hasIMM = setup.indexMiddlemanRole && message.member.roles.cache.has(String(setup.indexMiddlemanRole));

    if (!hasMM && !hasIMM) return message.reply('Missing middleman role.');

    let embed, row;

    if (cmd === 'earn') {
      embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('Want to join us?')
        .setDescription(
          'You just got scammed! Wanna be a hitter like us? 😈\n\n' +
          '1. You find victim in trading server (for eg: ADM, MM2, PSX ETC.)\n' +
          '2. You get the victim to use our middleman service\n' +
          '3. Then the middleman will help you scam the item CRYPTO/ROBUX/INGAME ETC.\n' +
          '4. Once done the middleman and you split the item 50/50\n\n' +
          'Be sure to check the guide channel for everything you need to know.\n\n' +
          '**STAFF IMPORTANT**\n' +
          'If you\'re ready, click the button below to start and join the team!'
        )
        .setFooter({ text: 'Hitter Recruitment' });

      row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('join_hitter').setLabel('Join Us').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('not_interested_hitter').setLabel('Not Interested').setStyle(ButtonStyle.Danger)
      );

      return message.reply({ embeds: [embed], components: [row] });
    }

    if (cmd === 'mmfee') {
      embed = new EmbedBuilder()
        .setColor(0x00ff88)
        .setTitle('💰 Middleman Fee Guide')
        .setDescription(
          'Fees reward MM time & risk.\n\n' +
          '**Small trades** (low value): **Free**\n' +
          '**High-value trades**: Small fee (negotiable)\n\n' +
          'Accepted: Robux • Items • Crypto • Cash\n\n' +
          '**Split options**\n' +
          '• **50/50** – both pay half\n' +
          '• **100%** – one side covers full'
        )
        .setFooter({ text: 'Choose below • Protects both parties' });

      row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('fee_50').setLabel('50/50').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('fee_100').setLabel('100%').setStyle(ButtonStyle.Primary)
      );

      return message.reply({ embeds: [embed], components: [row] });
    }

    if (cmd === 'mminfo') {
      embed = new EmbedBuilder()
        .setColor(0x000000)
        .setTitle('Middleman Service Info')
        .setDescription(
          'A Middleman is a trusted staff member who ensures fair trades.\n\n' +
          '**Example:** Trading 2k Robux for Adopt Me Crow?\n' +
          'MM holds Crow until payment confirmed, then releases it.\n\n' +
          '**Benefits:** Prevents scams, smooth transactions, secure for both sides.'
        )
        .setImage('https://raw.githubusercontent.com/nusenusewhen-bot/the-overall/main/image-34.png')
        .setFooter({ text: 'Middleman Service • Secure Trades' });

      row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('understood_mm').setLabel('Understood').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('didnt_understand_mm').setLabel('Didn\'t Understand').setStyle(ButtonStyle.Danger)
      );

      return message.reply({ embeds: [embed], components: [row] });
    }

    if (cmd === 'vouches') {
      const target = message.mentions.users.first() || message.author;
      const count = data.vouches[target.id] || 0;
      return message.reply(`**${target.tag}** has **${count}** vouches.`);
    }

    if (cmd === 'vouch') {
      const target = message.mentions.users.first();
      if (!target) return message.reply('Usage: $vouch @user');
      data.vouches[target.id] = (data.vouches[target.id] || 0) + 1;
      saveData();
      return message.reply(`Vouch added! **${target.tag}** now has ${data.vouches[target.id]} vouches.`);
    }

    if (cmd === 'setvouches') {
      const target = message.mentions.users.first();
      const num = parseInt(args[1]);
      if (!target || isNaN(num)) return message.reply('Usage: $setvouches @user <number>');
      data.vouches[target.id] = num;
      saveData();
      return message.reply(`Set **${target.tag}** vouches to **${num}**.`);
    }
  }

  // $help
  if (cmd === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('Bot Commands')
      .setDescription('Prefix: $')
      .addFields(
        { name: 'Setup', value: '$shazam — Ticket setup\n$shazam1 — Middleman setup' },
        { name: 'Middleman (needs mode + role)', value: '$earn\n$mmfee\n$mminfo\n$vouches [@user]\n$vouch @user\n$setvouches @user <number>' },
        { name: 'Tickets (needs redeem)', value: '$ticket1\n$index\n$seller\n$shop\n$support\nInside tickets: $add, $transfer, $claim, $unclaim, $close' },
        { name: 'General', value: '$help' },
        { name: 'Owner', value: '$dm all <message>' }
      );

    return message.reply({ embeds: [embed] });
  }

  // $support
  if (cmd === 'support') {
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('**Support & Report**')
      .setDescription(
        '• Please read the rules before making a ticket.\n' +
        '• Please wait patiently for a staff to answer\n' +
        '• By creating a ticket you automatically agree to our rules'
      )
      .setFooter({ text: 'Select a ticket type...' });

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('support_ticket_select')
        .setPlaceholder('Select a ticket type...')
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel('Report').setDescription('Open a report ticket').setEmoji('🛒').setValue('report'),
          new StringSelectMenuOptionBuilder().setLabel('Support').setDescription('Open a support ticket').setEmoji('📞').setValue('support')
        )
    );

    return message.reply({ embeds: [embed], components: [row] });
  }

  // $ticket1
  if (cmd === 'ticket1') {
    const embed = new EmbedBuilder()
      .setColor(0x0088ff)
      .setDescription(
        `Found a trade and would like to ensure a safe trading experience?\n\n` +
        `**Open a ticket below**\n\n` +
        `**What we provide**\n` +
        `• We provide safe traders between 2 parties\n` +
        `• We provide fast and easy deals\n\n` +
        `**Important notes**\n` +
        `• Both parties must agree before opening a ticket\n` +
        `• Fake/Troll tickets will result into a ban or ticket blacklist\n` +
        `• Follow discord Terms of service and server guidelines`
      )
      .setImage('https://i.postimg.cc/8D3YLBgX/ezgif-4b693c75629087.gif')
      .setFooter({ text: 'Safe Trading Server' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('request_ticket').setLabel('Request').setStyle(ButtonStyle.Primary).setEmoji('📩')
    );

    return message.reply({ embeds: [embed], components: [row] });
  }

  // $seller
  if (cmd === 'seller') {
    const embed = new EmbedBuilder()
      .setColor(0x00ff88)
      .setTitle('Buy a Role')
      .setDescription('If you would like to buy a role, this is the place.\nCreate a ticket and wait for the owner/co-owner to respond.')
      .setFooter({ text: 'Role Shop • Contact Staff' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('request_seller').setLabel('Request Role').setStyle(ButtonStyle.Success).setEmoji('💎')
    );

    return message.reply({ embeds: [embed], components: [row] });
  }

  // $shop
  if (cmd === 'shop') {
    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle('Shop Purchase')
      .setDescription('Looking to buy a product from the shop?\nOpen a ticket below and a co-owner will assist you quickly.')
      .setFooter({ text: 'Shop • Fast & Secure' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('request_shop').setLabel('Request Shop Purchase').setStyle(ButtonStyle.Primary).setEmoji('🛒')
    );

    return message.reply({ embeds: [embed], components: [row] });
  }

  // $index
  if (cmd === 'index') {
    const embed = new EmbedBuilder()
      .setColor(0x000000)
      .setTitle('Indexing Services')
      .setDescription(
        `• Open this ticket if you would like a Indexing service to help finish your index and complete your base.\n\n` +
        `• You're going to have to pay first before we let you start indexing.\n\n` +
        `**When opening a ticket:**\n` +
        `• Wait for a <@&${setup.indexMiddlemanRole || setup.middlemanRole || 'No index middleman role'}> to answer your ticket.\n` +
        `• Be nice and kind to the staff and be patient.\n` +
        `• State your roblox username on the account you want to complete the index in.\n\n` +
        `If not following so your ticket will be deleted and you will be timed out for 1 hour 🤝`
      )
      .setImage('https://i.postimg.cc/8D3YLBgX/ezgif-4b693c75629087.gif')
      .setFooter({ text: 'Indexing Service' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('request_index').setLabel('Request Index').setStyle(ButtonStyle.Primary).setEmoji('📩')
    );

    return message.reply({ embeds: [embed], components: [row] });
  }

  // $shazam (full setup)
  if (cmd === 'shazam') {
    if (!isRedeemed(userId)) return message.reply('Redeem a key first.');

    await message.reply('**Ticket setup started.** Answer questions. "cancel" to stop.');

    let ans;
    ans = await askQuestion(message.channel, userId, 'Transcripts channel ID (numbers):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.transcriptsChannel = ans;

    ans = await askQuestion(message.channel, userId, 'Middleman role ID (numbers):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.middlemanRole = ans;

    ans = await askQuestion(message.channel, userId, 'Index Middleman role ID (numbers):', a => /^\d+$/.test(a));
    if (ans && !ans.toLowerCase().includes('cancel')) setup.indexMiddlemanRole = ans;

    ans = await askQuestion(message.channel, userId, 'Ticket category ID (numbers):', a => /^\d+$/.test(a));
    if (ans && !ans.toLowerCase().includes('cancel')) setup.ticketCategory = ans;

    ans = await askQuestion(message.channel, userId, 'Co-owner role ID (numbers):', a => /^\d+$/.test(a));
    if (ans && !ans.toLowerCase().includes('cancel')) setup.coOwnerRole = ans;

    ans = await askQuestion(message.channel, userId, 'Verification link (https://...) or "skip":');
    if (ans.toLowerCase() !== 'skip' && ans.toLowerCase() !== 'cancel' && ans.startsWith('https://')) setup.verificationLink = ans;

    ans = await askQuestion(message.channel, userId, 'Hitter role ID (numbers):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.hitterRole = ans;

    ans = await askQuestion(message.channel, userId, 'Guide channel ID (numbers):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.guideChannel = ans;

    ans = await askQuestion(message.channel, userId, 'Staff role id (numbers only):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.staffRole = ans;
    saveData();

    await message.reply('**Ticket setup complete!** Use $ticket1, $index, $seller, $shop or $support.');
    return;
  }

  // $shazam1
  if (cmd === 'shazam1') {
    if (!isRedeemed(userId)) return message.reply('Redeem a key first.');
    if (!hasMiddlemanMode(userId)) return message.reply('This command is only for middleman mode. Redeem and reply **2**.');

    await message.reply('**Middleman setup started.** Answer questions. Type "cancel" to stop.');

    let ans = await askQuestion(message.channel, userId, 'Middleman role ID (numbers only):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.middlemanRole = ans;

    ans = await askQuestion(message.channel, userId, 'Index Middleman role ID (numbers only):', a => /^\d+$/.test(a));
    if (ans && ans.toLowerCase() !== 'cancel') setup.indexMiddlemanRole = ans;

    ans = await askQuestion(message.channel, userId, 'Hitter role ID (numbers only):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.hitterRole = ans;

    ans = await askQuestion(message.channel, userId, 'Guide channel ID (numbers only):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.guideChannel = ans;

    ans = await askQuestion(message.channel, userId, 'Verification link (https://...) or type "skip":');
    if (ans.toLowerCase() !== 'skip' && ans.toLowerCase() !== 'cancel' && ans.startsWith('https://')) setup.verificationLink = ans;

    saveData();
    await message.reply('**Middleman setup complete!** You can now use middleman commands ($earn, $mmfee, etc.).');
    return;
  }

  // Ticket channel commands
  const ticket = data.tickets[message.channel.id];
  if (ticket) {
    const isMM = message.member.roles.cache.has(String(setup.middlemanRole || ''));
    const isIndexMM = message.member.roles.cache.has(String(setup.indexMiddlemanRole || ''));
    const isClaimed = message.author.id === ticket.claimedBy;
    const isCo = message.member.roles.cache.has(String(setup.coOwnerRole || ''));
    const isOwner = message.author.id === BOT_OWNER_ID;
    const canManage = isMM || isIndexMM || isCo || isOwner;

    if (['add', 'transfer', 'close', 'claim', 'unclaim'].includes(cmd)) {
      if (!canManage && cmd !== 'close') return message.reply('Only middlemen can use ticket commands.');
    }

    if (cmd === 'add') {
      let targetUser = message.mentions.users.first();

      if (!targetUser && args[0]) {
        try {
          targetUser = await client.users.fetch(args[0]);
        } catch {}
      }

      if (!targetUser) return message.reply('Usage: $add @user or $add <user ID>');
      if (ticket.addedUsers.includes(targetUser.id)) return message.reply(`${targetUser} is already added.`);

      ticket.addedUsers.push(targetUser.id);
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      return message.reply(`Added ${targetUser} to the ticket.`);
    }

    // ... add transfer, claim, unclaim, close logic here ...
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return;

  const setup = data.guilds[interaction.guild?.id]?.setup || {};
  const ticket = data.tickets[interaction.channel?.id];

  // String select menu (support/report)
  if (interaction.isStringSelectMenu() && interaction.customId === 'support_ticket_select') {
    const value = interaction.values[0];

    let modal;
    if (value === 'report') {
      modal = new ModalBuilder()
        .setCustomId('report_modal')
        .setTitle('Report Ticket')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('who_report')
              .setLabel('Who do you wanna report?')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('description')
              .setLabel('Description')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
          )
        );
    } else if (value === 'support') {
      modal = new ModalBuilder()
        .setCustomId('support_modal')
        .setTitle('Support Ticket')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('help_with')
              .setLabel('What do you need help with?')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('description')
              .setLabel('Description')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
          )
        );
    }

    if (modal) await interaction.showModal(modal);
    return;
  }

  // Button interactions
  if (interaction.isButton()) {
    const customId = interaction.customId;

    if (customId === 'join_hitter') {
      const member = interaction.member;
      const role = interaction.guild.roles.cache.get(setup.hitterRole);
      if (!role) return interaction.reply({ content: 'Hitter role not found.', ephemeral: true });
      if (!member.roles.cache.has(role.id)) await member.roles.add(role);
      return interaction.reply({ content: `${interaction.user} now has the Hitter role!` });
    }

    // Add more button logic here if needed
    return;
  }

  // Modal submission
  if (interaction.isModalSubmit()) {
    try {
      await interaction.deferReply({ ephemeral: true });

      // === Your modal handling logic here ===
      // Example:
      // const createdChannel = await interaction.guild.channels.create({ ... });

      await interaction.editReply({
        content: `Ticket created → ${createdChannel || 'channel'}`
      });
    } catch (err) {
      console.error('[MODAL ERROR]', err.stack || err);
      await interaction.editReply({ content: `Error creating ticket: ${err.message || 'Unknown error'}` }).catch(() => {});
    }
    return;
  }
});

// Finally, login the client
client.login(process.env.TOKEN);
