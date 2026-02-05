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

  console.log(`[MSG] ${message.content} | Author: ${message.author.tag}`);

  const userId = message.author.id;
  const guildId = message.guild.id;
  if (!data.guilds[guildId]) data.guilds[guildId] = { setup: {} };
  const setup = data.guilds[guildId].setup;

  if (!data.userModes[userId]) data.userModes[userId] = { ticket: false };

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
      return message.reply('**Middleman mode activated!** Now run **$shazam1** to setup middleman roles.');
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
  if (['ticket1', 'index', 'seller', 'shop', 'support'].includes(cmd)) {
    if (!isRedeemed(userId)) return message.reply('Redeem a key first.');
    if (!hasTicketMode(userId)) return message.reply('Ticket mode not activated. Redeem a key and reply **1**.');
  }

  // Middleman commands
  if (['earn', 'mmfee', 'mminfo', 'vouches', 'vouch', 'setvouches'].includes(cmd)) {
    const hasMode = data.userModes[userId]?.middleman === true;
    const hasMM = setup.middlemanRole && message.member.roles.cache.has(String(setup.middlemanRole));
    const hasIMM = setup.indexMiddlemanRole && message.member.roles.cache.has(String(setup.indexMiddlemanRole));

    if (!hasMode && !hasMM && !hasIMM) {
      return message.reply('You need middleman mode (reply **2** after redeem) or the middleman/index middleman role.');
    }

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

      await message.reply({ embeds: [embed], components: [row] });
      return;
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

      await message.reply({ embeds: [embed], components: [row] });
      return;
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

      await message.reply({ embeds: [embed], components: [row] });
      return;
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
          new StringSelectMenuOptionBuilder()
            .setLabel('Report')
            .setDescription('Open a report ticket')
            .setEmoji('🛒')
            .setValue('report'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Support')
            .setDescription('Open a support ticket')
            .setEmoji('📞')
            .setValue('support')
        )
    );

    await message.reply({ embeds: [embed], components: [row] });
    return;
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
      new ButtonBuilder()
        .setCustomId('request_ticket')
        .setLabel('Request')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📩')
    );

    await message.reply({ embeds: [embed], components: [row] });
    return;
  }

  // $seller
  if (cmd === 'seller') {
    const embed = new EmbedBuilder()
      .setColor(0x00ff88)
      .setTitle('Buy a Role')
      .setDescription(
        `If you would like to buy a role, this is the place.\n` +
        `Create a ticket and wait for the owner/co-owner to respond.`
      )
      .setFooter({ text: 'Role Shop • Contact Staff' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('request_seller')
        .setLabel('Request Role')
        .setStyle(ButtonStyle.Success)
        .setEmoji('💎')
    );

    await message.reply({ embeds: [embed], components: [row] });
    return;
  }

  // $shop
  if (cmd === 'shop') {
    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle('Shop Purchase')
      .setDescription(
        'Looking to buy a product from the shop?\n' +
        'Open a ticket below and a co-owner will assist you quickly.\n\n' +
        '**Quick Notes:**\n' +
        '• Be ready with payment details\n' +
        '• No troll tickets — instant blacklist\n' +
        '• Respect the process — we sell premium items cheap\n' +
        '• Make your request clear to speed things up'
      )
      .addFields(
        { name: 'What to expect', value: 'Co-owner will respond shortly. Have your offer ready.' }
      )
      .setFooter({ text: 'Shop • Fast & Secure' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('request_shop')
        .setLabel('Request Shop Purchase')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🛒')
    );

    await message.reply({ embeds: [embed], components: [row] });
    return;
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
      new ButtonBuilder()
        .setCustomId('request_index')
        .setLabel('Request Index')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📩')
    );

    await message.reply({ embeds: [embed], components: [row] });
    return;
  }

  // $shazam
  if (cmd === 'shazam') {
    if (!isRedeemed(userId)) return message.reply('Redeem a key first.');

    message.reply('**Ticket setup started.** Answer questions. Type "cancel" to stop.');

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

    ans = await askQuestion(message.channel, userId, 'Verification link (https://...) or "skip":');
    if (ans.toLowerCase() !== 'skip' && ans.toLowerCase() !== 'cancel') {
      if (ans.startsWith('https://')) {
        setup.verificationLink = ans;
        saveData();
        message.reply(`Verification link saved.`);
      } else {
        message.reply('Invalid — skipped.');
      }
    } else if (ans.toLowerCase() === 'skip') {
      message.reply('Skipped.');
    }

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
    message.reply(`Staff role saved: \`${ans}\` (can see report & support tickets)`);

    saveData();
    message.reply('**Ticket setup complete!** Use $ticket1, $index, $seller, $shop or $support.');
    return;
  }

  // $shazam1
  if (cmd === 'shazam1') {
    if (!isRedeemed(userId)) return message.reply('Redeem a key first.');
    if (!data.userModes[userId]?.middleman) {
      return message.reply('This command is only for middleman mode. Redeem a key and reply **2** to activate middleman mode.');
    }

    message.reply('**Middleman setup started.** Answer questions. Type "cancel" to stop.');

    let ans;

    ans = await askQuestion(message.channel, userId, 'Middleman role ID (numbers only):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.middlemanRole = ans;
    message.reply(`Middleman role saved: \`${ans}\``);

    ans = await askQuestion(message.channel, userId, 'Index Middleman role ID (numbers only):', a => /^\d+$/.test(a));
    if (ans && ans.toLowerCase() !== 'cancel') {
      setup.indexMiddlemanRole = ans;
      saveData();
      message.reply(`Index Middleman role saved: \`${ans}\``);
    } else {
      message.reply('Skipped index middleman role.');
    }

    ans = await askQuestion(message.channel, userId, 'Hitter role ID (numbers only):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.hitterRole = ans;
    message.reply(`Hitter role saved: \`${ans}\``);

    ans = await askQuestion(message.channel, userId, 'Guide channel ID (numbers only):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.guideChannel = ans;
    message.reply(`Guide channel saved: \`${ans}\``);

    ans = await askQuestion(message.channel, userId, 'Verification link (https://...) or type "skip":');
    if (ans.toLowerCase() !== 'skip' && ans.toLowerCase() !== 'cancel') {
      if (ans.startsWith('https://')) {
        setup.verificationLink = ans;
        saveData();
        message.reply(`Verification link saved: \`${ans}\``);
      } else {
        message.reply('Invalid link — skipped.');
      }
    } else if (ans.toLowerCase() === 'skip') {
      message.reply('Verification link skipped.');
    }

    saveData();
    message.reply('**Middleman setup complete!** You can now use middleman commands ($earn, $mmfee, etc.).');
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
        } catch (fetchErr) {
          console.error('[ADD USER FETCH ERROR]', fetchErr.message);
        }
      }

      if (!targetUser) {
        return message.reply('Usage: $add @user or $add <user ID>\nCould not find user.');
      }

      if (ticket.addedUsers.includes(targetUser.id)) {
        return message.reply(`${targetUser} is already added to this ticket.`);
      }

      ticket.addedUsers.push(targetUser.id);
      saveData();

      await updateTicketPerms(message.channel, ticket, setup).catch(e => console.error('[ADD PERMS ERROR]', e));

      return message.reply(`Added ${targetUser} to the ticket.`);
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
      message.channel.send(`**${message.author} has claimed the ticket**`);
      return;
    }

    if (cmd === 'unclaim') {
      if (!ticket.claimedBy) return message.reply('Not claimed.');
      const isOwner = message.author.id === BOT_OWNER_ID;
      if (ticket.claimedBy !== message.author.id && !isOwner) return message.reply('Only claimer or bot owner can unclaim.');
      ticket.claimedBy = null;
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      message.channel.send(`**Ticket unclaimed by ${message.author}**`);
      return;
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
      return;
    }
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return;

  const setup = data.guilds[interaction.guild.id]?.setup || {};
  const ticket = data.tickets[interaction.channel?.id];

  // Support ticket select menu
  if (interaction.isStringSelectMenu() && interaction.customId === 'support_ticket_select') {
    const value = interaction.values[0];

    if (value === 'report') {
      const modal = new ModalBuilder().setCustomId('report_modal').setTitle('Report Ticket');
      modal.addComponents(
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
      await interaction.showModal(modal);
      return;
    }

    if (value === 'support') {
      const modal = new ModalBuilder().setCustomId('support_modal').setTitle('Support Ticket');
      modal.addComponents(
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
      await interaction.showModal(modal);
      return;
    }
  }

  // Ticket request buttons
  if (interaction.isButton()) {
    const customId = interaction.customId;

    if (customId === 'request_ticket') {
      const modal = new ModalBuilder().setCustomId('ticket_modal').setTitle('Trade Ticket Form');
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
      await interaction.showModal(modal);
      return;
    }

    if (customId === 'request_index') {
      const modal = new ModalBuilder().setCustomId('index_modal').setTitle('Request Indexing Service');
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
      await interaction.showModal(modal);
      return;
    }

    if (customId === 'request_seller') {
      const modal = new ModalBuilder().setCustomId('seller_modal').setTitle('Role Purchase Request');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('role_name').setLabel('What role are you buying?').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('payment').setLabel('What are you giving as payment?').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
      await interaction.showModal(modal);
      return;
    }

    if (customId === 'request_shop') {
      const modal = new ModalBuilder().setCustomId('shop_modal').setTitle('Shop Purchase Request');
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
      await interaction.showModal(modal);
      return;
    }

    // Other buttons - defer here
    try {
      if (['claim_ticket', 'unclaim_ticket', 'close_ticket'].includes(customId)) {
        await interaction.deferUpdate();
      } else {
        await interaction.deferReply({ ephemeral: true });
      }
    } catch (deferErr) {
      console.error('[DEFER ERROR]', deferErr.message);
      return;
    }

    if (customId === 'claim_ticket') {
      if (ticket.claimedBy) return interaction.editReply({ content: 'Already claimed.', components: [] });

      const hasMM = setup.middlemanRole && interaction.member.roles.cache.has(String(setup.middlemanRole));
      const hasIndexMM = setup.indexMiddlemanRole && interaction.member.roles.cache.has(String(setup.indexMiddlemanRole));

      if (!hasMM && !hasIndexMM) return interaction.editReply({ content: 'Only middlemen can claim this ticket.', components: [] });

      ticket.claimedBy = interaction.user.id;
      saveData();
      await updateTicketPerms(interaction.channel, ticket, setup).catch(e => console.error('Perms error on claim:', e));

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('unclaim_ticket').setLabel('Unclaim').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        content: `**${interaction.user} has claimed the ticket**`,
        components: [row]
      });

      await interaction.channel.send(`**${interaction.user} has claimed the ticket**`).catch(() => {});
      return;
    }

    // ... (unclaim, close, join_hitter, fee_50, fee_100, understood_mm, didnt_understand_mm - keep as before) ...
  }

  // MODAL SUBMIT
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
      const channel = await interaction.guild.channels.create({
        name: `${isReport ? 'report' : isSeller ? 'seller' : isIndex ? 'index' : isSupportModal ? 'support' : 'ticket'}-${safeUsername}`,
        type: ChannelType.GuildText,
        parent: setup.ticketCategory || undefined,
        permissionOverwrites: overwrites
      }).catch(e => {
        console.error('[CHANNEL CREATE ERROR]', e);
        throw e;
      });

      data.tickets[channel.id] = {
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
        .setDescription(
          isReport
            ? `Hello **${interaction.user}**! Your report ticket has been created.\n\n**Staff will review it soon.**\nPlease be patient.`
            : (isSeller
              ? `Hello **${interaction.user}**! Your role purchase request has been created.\n\n**A co-owner will respond shortly.**\nPlease be patient.`
              : (isIndex
                ? `Hello! A <@&${middlemanRole || 'No middleman role'}> will reply to you soon.\n\n**Read our rules before proceeding with the ticket**\n• Be patient\n• Get payment ready\n• Do not waste time`
                : (isSupportModal
                  ? `Hello **${interaction.user}**! Your support ticket has been created.\n\n**A staff member will respond as soon as possible.**\nPlease be patient and provide details.`
                  : `Hello **${interaction.user}**, thanks for opening a Middleman Ticket!\n\nA staff member will assist you shortly.\nProvide all trade details clearly.\n**Fake/troll tickets will result in consequences.**`
                )
              )
            )
        );

      if (isReport) {
        welcomeEmbed.addFields(
          { name: 'Who do you wanna report?', value: `<@${interaction.fields.getTextInputValue('who_report') || 'Not provided'}>` },
          { name: 'Description', value: interaction.fields.getTextInputValue('description') || 'Not provided' }
        );
      } else if (isSupportModal) {
        welcomeEmbed.addFields(
          { name: 'What do you need help with?', value: interaction.fields.getTextInputValue('help_with') || 'Not provided' },
          { name: 'Description', value: interaction.fields.getTextInputValue('description') || 'Not provided' }
        );
      } else if (isSeller) {
        welcomeEmbed.addFields(
          { name: 'Role requested', value: interaction.fields.getTextInputValue('role_name') || 'Not provided' },
          { name: 'Payment offered', value: interaction.fields.getTextInputValue('payment') || 'Not provided' }
        );
      } else if (isIndex) {
        welcomeEmbed.addFields(
          { name: 'What are you trying to index?', value: interaction.fields.getTextInputValue('index_item') || 'Not provided' },
          { name: 'Payment method', value: interaction.fields.getTextInputValue('payment_method') || 'Not provided' },
          { name: 'Understands must go first?', value: interaction.fields.getTextInputValue('go_first') || 'Not provided' }
        );
      } else if (isTicket) {
        welcomeEmbed.addFields(
          { name: 'Other User / ID', value: `<@${interaction.fields.getTextInputValue('other_id') || 'Not provided'}>` },
          { name: 'Trade Description', value: interaction.fields.getTextInputValue('trade_desc') || 'Not provided' },
          { name: 'Private Servers', value: interaction.fields.getTextInputValue('private_servers') || 'Not provided' }
        );
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Secondary)
      );

      const pingRole = isReport || isSeller ? setup.coOwnerRole : middlemanRole;
      await channel.send({
        content: pingRole ? `<@&${pingRole}> New ${isReport ? 'report' : (isSeller ? 'seller' : (isIndex ? 'index' : (isSupportModal ? 'support' : 'ticket')))}!` : 'New ticket created!',
        embeds: [welcomeEmbed],
        components: [row]
      }).catch(e => console.error('[WELCOME SEND ERROR]', e));

      await interaction.editReply(`Ticket created → ${channel}`);
    } catch (err) {
      console.error('[MODAL SUBMIT ERROR]', err.stack || err);
      await interaction.editReply({ content: `Error creating ticket: ${err.message || 'Unknown error'}` }).catch(() => {});
    }
  }
});

client.login(process.env.TOKEN);
