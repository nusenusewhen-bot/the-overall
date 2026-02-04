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

const BOT_OWNER_ID = 'YOUR_OWNER_ID_HERE'; // ← Replace with your Discord ID

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
    console.log('[DATA] Saved');
  } catch (err) {
    console.error('[DATA] Save failed:', err);
  }
}

function hasTicketMode(userId) { return data.userModes[userId]?.ticket === true; }
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

    if (ticket.isSellerTicket || ticket.isShopTicket) {
      if (setup.coOwnerRole) {
        await channel.permissionOverwrites.edit(setup.coOwnerRole, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true
        });
      }
    } else {
      const middlemanRole = ticket.isIndexTicket ? setup.indexMiddlemanRole : setup.middlemanRole;
      if (middlemanRole) {
        await channel.permissionOverwrites.edit(middlemanRole, {
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
    console.error('Perms error:', err);
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

  if (!data.userModes[userId]) data.userModes[userId] = { ticket: false };

  // AFK remove & ping block
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

  // Redeem reply
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
      return message.reply('**Middleman mode activated!** Now run **$shazam** to setup roles.');
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
    if (data.usedKeys.includes(key)) return message.reply('Key used.');

    const type = config.validKeys[key];
    data.usedKeys.push(key);
    data.redeemedUsers.add(userId);
    data.redeemPending[userId] = true;
    saveData();

    message.reply(`**${type} key activated!**\n**Only you** can reply now. Send **1** (Ticket) or **2** (Middleman)`);

    try {
      await message.author.send(`**Redeemed ${type}!**\nReply **1** or **2** in channel (only you can).`);
    } catch {}
    return;
  }

  // Ticket commands require ticket mode
  if (['ticket1', 'index', 'seller', 'shop'].includes(cmd)) {
    if (!isRedeemed(userId)) return message.reply('Redeem a key first.');
    if (!hasTicketMode(userId)) return message.reply('Ticket mode not activated. Redeem a key and reply **1**.');
  }

  // Middleman commands - role check only
  if (['schior', 'mmfee', 'mminfo', 'vouches', 'vouch', 'setvouches'].includes(cmd)) {
    const mm = setup.middlemanRole ? String(setup.middlemanRole) : null;
    const imm = setup.indexMiddlemanRole ? String(setup.indexMiddlemanRole) : null;

    if (!mm && !imm) return message.reply('No middleman roles set. Run $shazam.');

    const hasMM = mm && message.member.roles.cache.has(mm);
    const hasIMM = imm && message.member.roles.cache.has(imm);

    if (!hasMM && !hasIMM) return message.reply('You need the middleman or index middleman role.');
  }

  // $help
  if (cmd === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('Bot Commands')
      .setDescription('Prefix: $')
      .addFields(
        { name: 'Middleman (middleman or index middleman role required)', value: '$schior, $mmfee, $mminfo, $vouches [@user], $vouch @user, $setvouches @user <number>' },
        { name: 'Tickets (ticket mode required)', value: '$ticket1, $index, $seller, $shop\nInside tickets: $add, $transfer, $claim, $unclaim, $close' },
        { name: 'General', value: '$afk <reason>, $help' },
        { name: 'Owner', value: '$dm all <message>' }
      );

    return message.channel.send({ embeds: [embed] });
  }

  // $dm all
  if (cmd === 'dm all') {
    if (message.author.id !== BOT_OWNER_ID) return message.reply('Owner only.');
    if (!args.length) return message.reply('Usage: $dm all <message>');

    const msg = args.join(' ');
    let count = 0;
    const failed = [];

    await message.guild.members.fetch();
    for (const member of message.guild.members.cache.values()) {
      if (member.user.bot) continue;
      try {
        await member.send(msg);
        count++;
        await new Promise(r => setTimeout(r, 1000));
      } catch {
        failed.push(member.user.tag);
      }
    }

    return message.reply(`Sent to ${count} users.\nFailed: ${failed.length ? failed.join(', ') : 'None'}`);
  }

  // $ticket1, $index, $seller - keep as is (you can add later)

  // $shop
  if (cmd === 'shop') {
    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle('Welcome to my Shop')
      .setDescription(
        '@Welcome to my shop, if you are looking to buy something please make a ticket and wait patiently.\n\n' +
        '**Rules:**\n' +
        '1. If you make a troll ticket you will be blacklisted.\n' +
        '2. You dont wanna go first dont even open a ticket.\n' +
        '3. If you call me a scammer, mind then scamming you for real.\n' +
        '4. If you try to do anything stupid you will get banned.\n' +
        '5. Respect me as if im the one selling you things for cheap prices.\n' +
        '6. Also make your tickets make sense otherwise it will get closed.\n\n' +
        'Good luck.'
      )
      .setFooter({ text: 'Shop • Serious Buyers Only' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('request_shop')
        .setLabel('Open Shop Ticket')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🛒')
    );

    await message.channel.send({ embeds: [embed], components: [row] });
  }

  // Shazam setup
  if (cmd === 'shazam') {
    if (!isRedeemed(userId)) return message.reply('Redeem a key first.');
    if (!hasTicketMode(userId)) return message.reply('Ticket mode required (reply **1** after redeem).');

    await message.reply('**Setup started.** Answer questions. "cancel" to stop.');

    let ans;
    ans = await askQuestion(message.channel, userId, 'Transcripts channel ID (numbers):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.transcriptsChannel = ans;

    ans = await askQuestion(message.channel, userId, 'Middleman role ID (numbers):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.middlemanRole = ans;

    ans = await askQuestion(message.channel, userId, 'Index Middleman role ID (numbers):', a => /^\d+$/.test(a));
    if (ans && !ans.toLowerCase().includes('cancel')) {
      setup.indexMiddlemanRole = ans;
      saveData();
      message.reply(`Index Middleman role saved: \`${ans}\``);
    } else {
      message.reply('Skipped.');
    }

    ans = await askQuestion(message.channel, userId, 'Ticket category ID (numbers):', a => /^\d+$/.test(a));
    if (ans && !ans.toLowerCase().includes('cancel')) {
      setup.ticketCategory = ans;
      saveData();
      message.reply(`Ticket category saved: \`${ans}\``);
    } else {
      message.reply('Skipped.');
    }

    ans = await askQuestion(message.channel, userId, 'Co-owner role ID (numbers):', a => /^\d+$/.test(a));
    if (ans && !ans.toLowerCase().includes('cancel')) {
      setup.coOwnerRole = ans;
      saveData();
      message.reply(`Co-owner role saved: \`${ans}\``);
    } else {
      message.reply('Skipped.');
    }

    ans = await askQuestion(message.channel, userId, 'Hitter role ID (numbers):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.hitterRole = ans;

    ans = await askQuestion(message.channel, userId, 'Guide channel ID (numbers):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.guideChannel = ans;

    saveData();
    message.channel.send('**Setup complete!** Use $ticket1, $index, $seller or $shop.');
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
      const target = message.mentions.users.first() || client.users.cache.get(args[0]);
      if (!target) return message.reply('Usage: $add @user or $add ID');
      if (ticket.addedUsers.includes(target.id)) return message.reply('Already added.');
      ticket.addedUsers.push(target.id);
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      return message.reply(`Added ${target}.`);
    }

    if (cmd === 'transfer') {
      const target = message.mentions.users.first() || client.users.cache.get(args[0]);
      if (!target) return message.reply('Usage: $transfer @user or ID');
      if (!message.guild.members.cache.get(target.id)?.roles.cache.has(String(setup.middlemanRole))) return message.reply('Target must have middleman role.');
      ticket.claimedBy = target.id;
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      return message.reply(`Transferred claim to ${target}.`);
    }

    if (cmd === 'claim') {
      if (ticket.claimedBy) return message.reply('Already claimed.');
      if (!isMM && !isIndexMM) return message.reply('Only middlemen can claim.');
      ticket.claimedBy = message.author.id;
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      return message.reply(`**Ticket claimed by ${message.author}**`);
    }

    if (cmd === 'unclaim') {
      if (!ticket.claimedBy) return message.reply('Not claimed.');
      const isOwner = message.author.id === BOT_OWNER_ID;
      if (ticket.claimedBy !== message.author.id && !isOwner) return message.reply('Only claimer or bot owner can unclaim.');
      ticket.claimedBy = null;
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      return message.reply(`**Ticket unclaimed**`);
    }

    if (cmd === 'close') {
      if (!isClaimed && !isCo && !isOwner) return message.reply('Only claimer, co-owner or bot owner can close.');

      const msgs = await message.channel.messages.fetch({ limit: 100 });
      const transcript = msgs.reverse().map(m => `[${m.createdAt.toLocaleString('en-GB', { timeZone: 'Europe/London' })}] ${m.author.tag}: ${m.content || '[Media/Embed]'}`).join('\n');

      const chan = message.guild.channels.cache.get(setup.transcriptsChannel);
      if (chan) {
        const transcriptEmbed = new EmbedBuilder()
          .setColor(0x2f3136)
          .setTitle(`Transcript: ${message.channel.name}`)
          .setDescription(
            `**Created by:** <@${ticket.opener}>\n` +
            `**Claimed by:** ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Nobody'}\n` +
            `**Closed by:** <@${message.author.id}>\n` +
            `**Date:** ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'short' })}`
          )
          .setFooter({ text: 'Roblox Trading Core • Middleman Logs' })
          .setTimestamp();

        await chan.send({
          embeds: [transcriptEmbed],
          files: [{
            attachment: Buffer.from(transcript, 'utf-8'),
            name: `${message.channel.name}-transcript.txt`
          }]
        });
      }

      await message.reply('Closing ticket...');
      await message.channel.delete();
    }
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return;

  const setup = data.guilds[interaction.guild.id]?.setup || {};
  const ticket = data.tickets[interaction.channel?.id];

  if (interaction.isButton()) {
    if (interaction.customId === 'request_shop') {
      const modal = new ModalBuilder()
        .setCustomId('shop_modal')
        .setTitle('Shop Purchase Request');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('product')
            .setLabel('What product are you buying??')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('quantity')
            .setLabel('How much of the product are you willing to buy?')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('payment_method')
            .setLabel('Whats your payment method?')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );

      await interaction.showModal(modal);
      return;
    }

    // ... other buttons (claim, unclaim, etc.) remain as is
  }

  if (interaction.isModalSubmit()) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const isShop = interaction.customId === 'shop_modal';

    if (!isShop) {
      return interaction.editReply('Wrong modal type.');
    }

    const product = interaction.fields.getTextInputValue('product') || 'Not provided';
    const quantity = interaction.fields.getTextInputValue('quantity') || 'Not provided';
    const payment = interaction.fields.getTextInputValue('payment_method') || 'Not provided';

    const overwrites = [
      { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
    ];

    if (setup.coOwnerRole) {
      overwrites.push({
        id: setup.coOwnerRole,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
      });
    }

    try {
      const safeUsername = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '');
      const channel = await interaction.guild.channels.create({
        name: `shop-${safeUsername}`,
        type: ChannelType.GuildText,
        parent: setup.ticketCategory || undefined,
        permissionOverwrites: overwrites
      });

      data.tickets[channel.id] = {
        opener: interaction.user.id,
        claimedBy: null,
        addedUsers: [],
        isShopTicket: true
      };
      saveData();

      const welcomeEmbed = new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle('Shop Purchase Request')
        .setDescription(`Hello **${interaction.user}**! Your request has been created.\nA co-owner will respond soon.`)
        .addFields(
          { name: 'Product', value: product },
          { name: 'Quantity', value: quantity },
          { name: 'Payment Method', value: payment }
        );

      await channel.send({
        content: setup.coOwnerRole ? `<@&${setup.coOwnerRole}> New shop ticket!` : '@here New shop ticket!',
        embeds: [welcomeEmbed]
      });

      await interaction.editReply(`Ticket created → ${channel}`);
    } catch (err) {
      console.error('Ticket creation error:', err);
      await interaction.editReply('Failed to create ticket: ' + err.message);
    }
  }
});

client.login(process.env.TOKEN);
