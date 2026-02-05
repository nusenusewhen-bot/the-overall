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

  const redeemRequiredCommands = ['ticket1', 'index', 'seller', 'shop', 'support'];

  if (redeemRequiredCommands.includes(cmd)) {
    if (!isRedeemed(userId)) {
      return message.reply('You must redeem a key first.');
    }
  }

  if (['earn', 'mmfee', 'mminfo', 'vouches', 'vouch', 'setvouches'].includes(cmd)) {
    if (!isRedeemed(userId) || !hasMiddlemanMode(userId)) return;

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

    // ... mmfee, mminfo, vouches, vouch, setvouches (keep as is) ...
  }

  // $help, $support, $ticket1, $seller, $shop, $index, $shazam, $shazam1 (keep as is from your previous working version)

  const ticket = data.tickets[message.channel.id];
  if (ticket) {
    // ... ticket commands ($add, $transfer, $claim, $unclaim, $close) ...
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return;

  const setup = data.guilds[interaction.guild.id]?.setup || {};
  const ticket = data.tickets[interaction.channel?.id];

  // Support ticket select menu
  if (interaction.isStringSelectMenu() && interaction.customId === 'support_ticket_select') {
    const value = interaction.values[0];

    let modal;
    if (value === 'report') {
      modal = new ModalBuilder().setCustomId('report_modal').setTitle('Report Ticket');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('who_report').setLabel('Who do you wanna report?').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true))
      );
    } else if (value === 'support') {
      modal = new ModalBuilder().setCustomId('support_modal').setTitle('Support Ticket');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('help_with').setLabel('What do you need help with?').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true))
      );
    }

    if (modal) await interaction.showModal(modal);
    return;
  }

  // Request buttons (ticket, index, seller, shop)
  if (interaction.isButton() && interaction.customId.startsWith('request_')) {
    let modal;
    // ... your modal creation for request_ticket, request_index, request_seller, request_shop ...
    if (modal) await interaction.showModal(modal);
    return;
  }

  // Middleman buttons
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

    // ... other middleman buttons (not_interested_hitter, fee_50, fee_100, understood_mm, didnt_understand_mm) ...

    // Ticket buttons
    if (['claim_ticket', 'unclaim_ticket', 'close_ticket'].includes(customId)) {
      try {
        await interaction.deferUpdate();
      } catch (err) {
        console.error('[DEFER ERROR]', err);
      }
      // ... claim/unclaim/close logic ...
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
      const createdChannel = await interaction.guild.channels.create({
        name: `${isReport ? 'report' : isSeller ? 'seller' : isIndex ? 'index' : isSupportModal ? 'support' : 'ticket'}-${safeUsername}`,
        type: ChannelType.GuildText,
        parent: setup.ticketCategory || undefined,
        permissionOverwrites: overwrites
      });

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
        .setDescription(/* your description logic here */);

      // Add fields from modal
      if (isReport) {
        welcomeEmbed.addFields(
          { name: 'Who do you wanna report?', value: `<@${interaction.fields.getTextInputValue('who_report') || 'Not provided'}>` },
          { name: 'Description', value: interaction.fields.getTextInputValue('description') || 'Not provided' }
        );
      } // ... add for other types

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Secondary)
      );

      const pingRole = isReport || isSeller ? setup.coOwnerRole : middlemanRole;
      await createdChannel.send({
        content: pingRole ? `<@&${pingRole}> New ${isReport ? 'report' : (isSeller ? 'seller' : (isIndex ? 'index' : (isSupportModal ? 'support' : 'ticket')))}!` : 'New ticket created!',
        embeds: [welcomeEmbed],
        components: [row]
      });

      // SUCCESS - only here if everything above succeeded
      await interaction.editReply({ content: `Ticket created → ${createdChannel}` });

    } catch (err) {
      console.error('[MODAL SUBMIT ERROR]', err.stack || err);
      await interaction.editReply({ content: `Error creating ticket: ${err.message || 'Unknown error (check bot permissions/category ID)'}` }).catch(() => {});
    }
  }
});

client.login(process.env.TOKEN);
