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

async function updateClaimButton(channel, claimedBy) {
  const messages = await channel.messages.fetch({ limit: 10 });
  const ticketMsg = messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.components.length > 0);

  if (!ticketMsg) return;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('claim_ticket')
      .setLabel('Claim')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!!claimedBy),
    new ButtonBuilder()
      .setCustomId('unclaim_ticket')
      .setLabel('Unclaim')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!claimedBy),
    new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('Close')
      .setStyle(ButtonStyle.Secondary)
  );

  await ticketMsg.edit({ components: [row] }).catch(e => console.error('[BUTTON UPDATE ERROR]', e));
}

client.once('ready', () => {
  console.log(`[READY] ${client.user.tag} online`);
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  console.log(`[MSG] ${message.author.tag}: ${message.content}`);

  const userId = message.author.id;
  const guildId = message.guild.id;
  if (!data.guilds[guildId]) data.guilds[guildId] = { setup: {} };
  const setup = data.guilds[guildId].setup;

  if (!data.userModes[userId]) data.userModes[userId] = { ticket: false, middleman: false };

  // Handle redeem reply FIRST (before prefix check)
  if (data.redeemPending[userId]) {
    const content = message.content.trim().toLowerCase();

    if (content === '1' || content === 'ticket') {
      data.userModes[userId].ticket = true;
      delete data.redeemPending[userId];
      saveData();
      console.log(`[MODE] ${message.author.tag} → TICKET`);
      return message.reply('**Ticket mode activated!** Use $shazam.');
    }

    if (content === '2' || content === 'middleman') {
      data.userModes[userId].middleman = true;
      delete data.redeemPending[userId];
      saveData();
      console.log(`[MODE] ${message.author.tag} → MIDDLEMAN`);
      return message.reply('**Middleman mode activated!** Now run **$shazam1**.');
    }

    console.log(`[PENDING INVALID] ${message.author.tag} replied: ${content}`);
    return message.reply('Reply **1** (Ticket) or **2** (Middleman) only.');
  }

  if (!message.content.startsWith(config.prefix)) return;

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  console.log(`[CMD] ${message.author.tag} used $${cmd}`);

  if (cmd === 'redeem') {
    if (!args[0]) return message.reply('Usage: $redeem <key>');
    const key = args[0];
    if (!config.validKeys[key]) return message.reply('Invalid key.');
    if (data.usedKeys.includes(key)) return message.reply('Key already used.');

    data.usedKeys.push(key);
    data.redeemedUsers.add(userId);
    data.redeemPending[userId] = true;
    saveData();

    console.log(`[REDEEM] ${message.author.tag} redeemed ${key}`);
    message.reply(`**Key activated!**\nReply **1** (Ticket mode) or **2** (Middleman mode) now.`);
    try { await message.author.send(`**Key redeemed!**\nReply **1** or **2** in channel.`); } catch {}
    return;
  }

  const redeemRequiredCommands = ['ticket1', 'index', 'seller', 'shop', 'support'];

  if (redeemRequiredCommands.includes(cmd)) {
    if (!isRedeemed(userId)) {
      console.log(`[BLOCK REDEEM] ${message.author.tag} tried ${cmd}`);
      return message.reply('You must redeem a key first.');
    }
  }

  if (['earn', 'mmfee', 'mminfo', 'vouches', 'vouch', 'setvouches'].includes(cmd)) {
    if (!isRedeemed(userId) || !hasMiddlemanMode(userId)) {
      console.log(`[BLOCK MM] ${message.author.tag} tried ${cmd}`);
      return;
    }

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

  if (cmd === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('Bot Commands')
      .setDescription('Prefix: $')
      .addFields(
        { name: 'Setup', value: '$shazam — Ticket setup\n$shazam1 — Middleman setup' },
        { name: 'Middleman (needs mode + role)', value: '$earn\n$mmfee\n$mminfo\n$vouches [@user]\n$vouch @user\n$setvouches @user <number>' },
        { name: 'Tickets (needs redeem)', value: '$ticket1\n$index\n$seller\n$shop\n$support\nInside tickets: $add, $claim, $unclaim, $transfer, $close' },
        { name: 'General', value: '$help' }
      );

    return message.reply({ embeds: [embed] });
  }

  // $support, $ticket1, $seller, $shop, $index (your original implementations)

  const ticket = data.tickets[message.channel.id];
  if (ticket) {
    const isMM = message.member.roles.cache.has(String(setup.middlemanRole || ''));
    const isIndexMM = message.member.roles.cache.has(String(setup.indexMiddlemanRole || ''));
    const isClaimed = message.author.id === ticket.claimedBy;
    const isCo = message.member.roles.cache.has(String(setup.coOwnerRole || ''));
    const isOwner = message.author.id === BOT_OWNER_ID;
    const canManage = isMM || isIndexMM || isCo || isOwner;

    if (['add', 'claim', 'unclaim', 'transfer', 'close'].includes(cmd)) {
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

    if (cmd === 'claim') {
      if (ticket.claimedBy) return message.reply('Already claimed.');
      if (!isMM && !isIndexMM) return message.reply('Only middlemen can claim.');
      ticket.claimedBy = message.author.id;
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      await message.channel.send(`**${message.author} has claimed the ticket**`);
      await updateClaimButton(message.channel, ticket.claimedBy);
      return;
    }

    if (cmd === 'unclaim') {
      if (!ticket.claimedBy) return message.reply('Not claimed.');
      if (ticket.claimedBy !== message.author.id && message.author.id !== BOT_OWNER_ID) return message.reply('Only claimer or bot owner can unclaim.');
      ticket.claimedBy = null;
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      await message.channel.send(`**${message.author} unclaimed the ticket**`);
      await updateClaimButton(message.channel, null);
      return;
    }

    if (cmd === 'transfer') {
      if (!ticket.claimedBy) return message.reply('Ticket not claimed yet.');
      if (ticket.claimedBy !== message.author.id && message.author.id !== BOT_OWNER_ID) return message.reply('Only current claimer or bot owner can transfer.');

      let targetUser = message.mentions.users.first();

      if (!targetUser && args[0]) {
        try {
          targetUser = await client.users.fetch(args[0]);
        } catch {}
      }

      if (!targetUser) return message.reply('Usage: $transfer @user or $transfer <user ID>');
      if (!targetUser.roles.cache.has(String(setup.middlemanRole)) && !targetUser.roles.cache.has(String(setup.indexMiddlemanRole))) return message.reply('Target must have middleman role.');

      ticket.claimedBy = targetUser.id;
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      await message.channel.send(`**${message.author} transferred claim to ${targetUser}**`);
      await updateClaimButton(message.channel, ticket.claimedBy);
      return;
    }

    if (cmd === 'close') {
      if (!isClaimed && !isCo && !isOwner) return message.reply('Only claimer, co-owner or bot owner can close.');

      const msgs = await message.channel.messages.fetch({ limit: 100 });
      const transcript = msgs.reverse().map(m => `[${m.createdAt.toLocaleString('en-GB')}] ${m.author.tag}: ${m.content || '[Media]'}`).join('\n');

      const chan = message.guild.channels.cache.get(setup.transcriptsChannel);
      if (chan) {
        await chan.send({
          content: `Transcript for ${message.channel.name}`,
          files: [{ attachment: Buffer.from(transcript, 'utf-8'), name: `${message.channel.name}-transcript.txt` }]
        });
      }

      await message.reply('Closing ticket...');
      await message.channel.delete();
      return;
    }
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return;

  const setup = data.guilds[interaction.guild.id]?.setup || {};
  const ticket = data.tickets[interaction.channel?.id];

  if (interaction.isStringSelectMenu() && interaction.customId === 'support_ticket_select') {
    const value = interaction.values[0];

    let modal;
    if (value === 'report') {
      modal = new ModalBuilder().setCustomId('report_modal').setTitle('Report Ticket');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('who_report').setLabel('Who do you wanna report?').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true)
        )
      );
    } else if (value === 'support') {
      modal = new ModalBuilder().setCustomId('support_modal').setTitle('Support Ticket');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('help_with').setLabel('What do you need help with?').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true)
        )
      );
    }

    if (modal) await interaction.showModal(modal);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('request_')) {
    let modal;
    if (interaction.customId === 'request_ticket') {
      modal = new ModalBuilder().setCustomId('ticket_modal').setTitle('Trade Ticket Form');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('other_id').setLabel("Other person's ID / username?").setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('trade_desc').setLabel('Describe the trade').setStyle(TextInputStyle.Paragraph).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('private_servers').setLabel('Can both join private servers?').setStyle(TextInputStyle.Short).setRequired(false)
        )
      );
    } else if (interaction.customId === 'request_index') {
      modal = new ModalBuilder().setCustomId('index_modal').setTitle('Request Indexing Service');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('index_item').setLabel('What are you trying to index?').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('payment_method').setLabel('What is your payment method?').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('go_first').setLabel('You understand you must go first?').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
    } else if (interaction.customId === 'request_seller') {
      modal = new ModalBuilder().setCustomId('seller_modal').setTitle('Role Purchase Request');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('role_name').setLabel('What role are you buying?').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('payment').setLabel('What are you giving as payment?').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
    } else if (interaction.customId === 'request_shop') {
      modal = new ModalBuilder().setCustomId('shop_modal').setTitle('Shop Purchase Request');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('product').setLabel('Product you want to buy?').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('quantity').setLabel('Quantity you want?').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('payment_method').setLabel('Payment method?').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
    }

    if (modal) await interaction.showModal(modal);
    return;
  }

  if (interaction.isButton()) {
    const customId = interaction.customId;

    if (customId === 'join_hitter') {
      const guild = interaction.guild;
      const member = interaction.member;
      const hitterRoleId = setup.hitterRole;

      if (!hitterRoleId) return interaction.reply({ content: 'Hitter role not set.', ephemeral: true });

      const role = guild.roles.cache.get(hitterRoleId);
      if (!role) return interaction.reply({ content: 'Hitter role not found.', ephemeral: true });

      let alreadyHadRole = member.roles.cache.has(hitterRoleId);

      if (!alreadyHadRole) {
        try {
          await member.roles.add(role);
        } catch (err) {
          console.error('[ROLE ADD ERROR]', err);
          return interaction.reply({ content: 'Failed to add hitter role.', ephemeral: true });
        }
      }

      await interaction.reply({
        content: `${interaction.user} ${alreadyHadRole ? 'already has' : 'now has'} the Hitter role!`
      });

      if (!alreadyHadRole && setup.guideChannel) {
        const guideChannel = guild.channels.cache.get(setup.guideChannel);
        if (guideChannel?.isTextBased()) {
          const verificationLink = setup.verificationLink || '(not set)';

          await guideChannel.send({
            content: `${interaction.user} just joined the hitters!\n\n` +
                     `Welcome! Read everything here carefully.\n\n` +
                     `**Verification steps:**\n` +
                     `1. Go to this link: ${verificationLink}\n` +
                     `2. Follow the instructions to verify your account.\n` +
                     `3. Once verified, you can start hitting.\n\n` +
                     `If you have questions, ping a staff member. Good luck!`
          }).catch(err => console.error('[GUIDE SEND ERROR]', err));
        }
      }

      return;
    }

    if (customId === 'claim_ticket') {
      if (!ticket) return interaction.reply({ content: 'Ticket not found.', ephemeral: true });
      if (ticket.claimedBy) return interaction.reply({ content: 'Ticket already claimed.', ephemeral: true });

      const member = interaction.member;
      const isMM = member.roles.cache.has(String(setup.middlemanRole || ''));
      const isIndexMM = member.roles.cache.has(String(setup.indexMiddlemanRole || ''));
      if (!isMM && !isIndexMM) return interaction.reply({ content: 'Only middlemen can claim.', ephemeral: true });

      ticket.claimedBy = interaction.user.id;
      saveData();
      await updateTicketPerms(interaction.channel, ticket, setup);
      await interaction.channel.send(`**${interaction.user} has claimed the ticket**`);
      await updateClaimButton(interaction.channel, ticket.claimedBy);
      await interaction.deferUpdate();
      return;
    }

    if (customId === 'unclaim_ticket') {
      if (!ticket) return interaction.reply({ content: 'Ticket not found.', ephemeral: true });
      if (!ticket.claimedBy) return interaction.reply({ content: 'Ticket not claimed.', ephemeral: true });
      if (ticket.claimedBy !== interaction.user.id && interaction.user.id !== BOT_OWNER_ID) return interaction.reply({ content: 'Only claimer or bot owner can unclaim.', ephemeral: true });

      ticket.claimedBy = null;
      saveData();
      await updateTicketPerms(interaction.channel, ticket, setup);
      await interaction.channel.send(`**${interaction.user} unclaimed the ticket**`);
      await updateClaimButton(interaction.channel, null);
      await interaction.deferUpdate();
      return;
    }

    if (customId === 'close_ticket') {
      await interaction.deferUpdate();
      // close logic...
    }
  }

  if (interaction.isModalSubmit()) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const isIndex = interaction.customId === 'index_modal';
      const isSeller = interaction.customId === 'seller_modal';
      const isReport = interaction.customId === 'report_modal';
      const isSupportModal = interaction.customId === 'support_modal';
      const isTicket = interaction.customId === 'ticket_modal';

      const middlemanRole = isIndex ? setup.indexMiddlemanRole : setup.middlemanRole;

      const overwrites = [
        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
      ];

      if ((isReport || isSupportModal) && setup.staffRole) {
        overwrites.push({
          id: setup.staffRole,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
        });
      }

      if (isSeller || isReport) {
        if (setup.coOwnerRole) {
          overwrites.push({
            id: setup.coOwnerRole,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
          });
        }
      } else if (middlemanRole) {
        overwrites.push({
          id: middlemanRole,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
          deny: [PermissionsBitField.Flags.SendMessages]
        });
      }

      if (setup.coOwnerRole) {
        overwrites.push({
          id: setup.coOwnerRole,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
        });
      }

      const safeUsername = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '');
      let createdChannel;

      try {
        createdChannel = await interaction.guild.channels.create({
          name: `${isReport ? 'report' : isSeller ? 'seller' : isIndex ? 'index' : isSupportModal ? 'support' : 'ticket'}-${safeUsername}`,
          type: ChannelType.GuildText,
          parent: setup.ticketCategory || undefined,
          permissionOverwrites: overwrites,
          reason: `Ticket created by ${interaction.user.tag}`
        });
      } catch (createErr) {
        console.error('[CHANNEL CREATE ERROR]', createErr.message);
        throw new Error(`Failed to create channel: ${createErr.message}`);
      }

      data.tickets[createdChannel.id] = {
        opener: interaction.user.id,
        claimedBy: null,
        addedUsers: [],
        isIndexTicket: isIndex,
        isSellerTicket: isSeller,
        isReportTicket: isReport,
        isTradeTicket: isTicket,
        isSupportTicket: isSupportModal
      };
      saveData();

      const welcomeEmbed = new EmbedBuilder()
        .setColor(isReport ? 0xff0000 : isSeller ? 0x00ff88 : isIndex ? 0x000000 : isSupportModal ? 0x5865F2 : 0x0088ff)
        .setTitle(isReport ? 'Report Ticket' : isSeller ? 'Role Purchase Request' : isIndex ? 'Index Requesting' : isSupportModal ? 'Support Ticket' : 'Welcome to your Ticket!')
        .setDescription('Ticket created successfully. Staff will be with you shortly.');

      // Add modal fields to welcome embed
      if (isReport) {
        welcomeEmbed.addFields(
          { name: 'Reported User', value: `<@${interaction.fields.getTextInputValue('who_report') || 'Not provided'}>` },
          { name: 'Description', value: interaction.fields.getTextInputValue('description') || 'Not provided' }
        );
      } else if (isSupportModal) {
        welcomeEmbed.addFields(
          { name: 'Issue', value: interaction.fields.getTextInputValue('help_with') || 'Not provided' },
          { name: 'Description', value: interaction.fields.getTextInputValue('description') || 'Not provided' }
        );
      } // Add more for other modals as needed

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success).setDisabled(false),
        new ButtonBuilder().setCustomId('unclaim_ticket').setLabel('Unclaim').setStyle(ButtonStyle.Danger).setDisabled(true),
        new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Secondary)
      );

      await createdChannel.send({
        content: `<@&${setup.staffRole || setup.middlemanRole || setup.coOwnerRole || ''}> New ticket!`,
        embeds: [welcomeEmbed],
        components: [row]
      }).catch(e => console.error('[WELCOME ERROR]', e));

      await interaction.editReply({ content: `Ticket created → ${createdChannel}` });

    } catch (err) {
      console.error('[MODAL SUBMIT ERROR]', err.message || err);
      await interaction.editReply({
        content: `Error creating ticket: ${err.message || 'Unknown error (check bot perms / category ID)'}`,
      }).catch(() => {});
    }
  }
});

client.login(process.env.TOKEN);
