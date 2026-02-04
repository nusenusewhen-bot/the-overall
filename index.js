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

const BOT_OWNER_ID = '1298640383688970293'; // ← Replace with your real Discord ID

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
    console.log('[DATA] Loaded existing data');
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

client.once('ready', () => {
  console.log(`[READY] Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  const userId = message.author.id;
  const guildId = message.guild.id;
  if (!data.guilds[guildId]) data.guilds[guildId] = { setup: {} };
  const setup = data.guilds[guildId].setup;

  if (!data.userModes[userId]) data.userModes[userId] = { ticket: false };

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
      message.reply('**Middleman mode activated!** Use $schior.');

      await message.channel.send('**Middleman role ID** (numbers only):');
      const roleId = await askQuestion(message.channel, userId, 'Middleman role ID (numbers only):', ans => /^\d+$/.test(ans));
      if (roleId) {
        data.guilds[guildId].setup.middlemanRole = roleId;
        saveData();
        message.reply(`Middleman role saved: \`${roleId}\``);
      } else {
        message.reply('Cancelled or invalid.');
      }

      await message.channel.send('**Index Middleman role ID** (numbers only):');
      const indexRoleId = await askQuestion(message.channel, userId, 'Index Middleman role ID (numbers only):', ans => /^\d+$/.test(ans));
      if (indexRoleId) {
        data.guilds[guildId].setup.indexMiddlemanRole = indexRoleId;
        saveData();
        message.reply(`Index Middleman role saved: \`${indexRoleId}\``);
      } else {
        message.reply('Skipped or invalid.');
      }

      await message.channel.send('**Hitter role ID** (numbers only):');
      const hitterId = await askQuestion(message.channel, userId, 'Hitter role ID (numbers only):', ans => /^\d+$/.test(ans));
      if (hitterId) {
        data.guilds[guildId].setup.hitterRole = hitterId;
        saveData();
        message.reply(`Hitter role saved: \`${hitterId}\``);
      } else {
        message.reply('Cancelled or invalid.');
      }

      await message.channel.send('**Welcome hitter channel ID** (numbers only):');
      const welcomeId = await askQuestion(message.channel, userId, 'Welcome channel ID (numbers only):', ans => /^\d+$/.test(ans));
      if (welcomeId) {
        data.guilds[guildId].setup.welcomeHitterChannel = welcomeId;
        saveData();
        message.reply(`Welcome channel saved: \`${welcomeId}\``);
      } else {
        message.reply('Cancelled or invalid.');
      }

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

  // Middleman commands - allow both middleman and index middleman roles
  if (['schior', 'mmfee', 'mminfo', 'vouches', 'vouch', 'setvouches'].includes(cmd)) {
    const mm = setup.middlemanRole ? String(setup.middlemanRole) : null;
    const imm = setup.indexMiddlemanRole ? String(setup.indexMiddlemanRole) : null;

    if (!mm && !imm) return message.reply('No middleman roles configured. Run $shazam.');

    const hasMM = mm && message.member.roles.cache.has(mm);
    const hasIMM = imm && message.member.roles.cache.has(imm);

    if (!hasMM && !hasIMM) return message.reply('You need the middleman or index middleman role to use this command.');

    // Command execution below...
  }

  // $help
  if (cmd === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('Bot Commands')
      .setDescription('Prefix: $')
      .addFields(
        {
          name: 'Middleman Commands',
          value: 
            '`$schior` — Post hitter recruitment embed\n' +
            '`$mmfee` — Show fee options\n' +
            '`$mminfo` — Show middleman info\n' +
            '`$vouches [@user]` — Show vouches\n' +
            '`$vouch @user` — Add vouch\n' +
            '`$setvouches @user <number>` — Set vouches'
        },
        {
          name: 'Ticket Commands',
          value: 
            '`$ticket1` — Trade ticket panel\n' +
            '`$index` — Indexing panel\n' +
            '`$seller` — Role purchase panel\n' +
            '`$shop` — Shop panel\n' +
            '\nInside tickets:\n' +
            '`$add @user` — Add user\n' +
            '`$transfer @user` — Transfer claim\n' +
            '`$claim` — Claim ticket\n' +
            '`$unclaim` — Unclaim ticket\n' +
            '`$close` — Close ticket'
        },
        {
          name: 'General',
          value: 
            '`$afk <reason>` — Set AFK\n' +
            '`$help` — This menu'
        },
        {
          name: 'Owner',
          value: 
            '`$dm all <message>` — Mass DM'
        }
      )
      .setFooter({ text: 'Redeem key to use' });

    return message.channel.send({ embeds: [embed] });
  }

  // Owner $dm all
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

    await message.channel.send({ embeds: [embed], components: [row] });
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

    await message.channel.send({ embeds: [embed], components: [row] });
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

    await message.channel.send({ embeds: [embed], components: [row] });
  }

  // $shop - rewritten clean version
  if (cmd === 'shop') {
    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle('Welcome to My Shop')
      .setDescription(
        'Welcome to my shop! If you\'re looking to buy something, open a ticket below and wait patiently for a response.\n\n' +
        'Please follow the rules to avoid issues.'
      )
      .addFields(
        { name: 'Rules', value: 
          '1. Troll tickets = blacklist.\n' +
          '2. Don\'t open if you don\'t want to go first.\n' +
          '3. Call me scammer? I\'ll scam you for real.\n' +
          '4. Stupid actions = ban.\n' +
          '5. Respect me — I sell cheap.\n' +
          '6. Tickets must make sense or get closed.',
          inline: false
        }
      )
      .setFooter({ text: 'Shop • Serious Buyers Only • Good luck!' })
      .setTimestamp();

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
    if (interaction.customId === 'request_ticket') {
      const modal = new ModalBuilder()
        .setCustomId('ticket_modal')
        .setTitle('Trade Ticket Form');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('other_id')
            .setLabel("Other person's ID / username?")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('trade_desc')
            .setLabel('Describe the trade')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('private_servers')
            .setLabel('Can both join private servers?')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
        )
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === 'request_index') {
      const modal = new ModalBuilder()
        .setCustomId('index_modal')
        .setTitle('Request Indexing Service');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('index_item')
            .setLabel('What are you trying to index?')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('payment_method')
            .setLabel('What is your payment method?')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('go_first')
            .setLabel('You understand you must go first?')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === 'request_seller') {
      const modal = new ModalBuilder()
        .setCustomId('seller_modal')
        .setTitle('Role Purchase Request');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('role_name')
            .setLabel('What role are you buying?')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('payment')
            .setLabel('What are you giving as payment?')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );

      await interaction.showModal(modal);
      return;
    }

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

    if (interaction.customId === 'join_hitter') {
      const member = interaction.member;
      if (!member.roles.cache.has(String(setup.hitterRole || '')) && setup.hitterRole) {
        await member.roles.add(setup.hitterRole);
      }

      const welcomeChan = interaction.guild.channels.cache.get(setup.welcomeHitterChannel);
      if (welcomeChan) {
        await welcomeChan.send(
          `**${interaction.user} has became a hitter**, please make sure he feels welcomed and make sure you have fun.\n\n` +
          `**Guide**\n` +
          `**How to hit** | go to a trading server, find a trade then convince them to use our middleman service, after that the middleman will help you scam.\n` +
          `After all accomplished the middleman will split 50/50.\n\n` +
          `**How to alt hit.**\n` +
          `you need 2 devices or 2 different discords,\n` +
          `you have to act like a normal trader in a different account, make sure its the one without middleman role, then convince them to use our middleman service and scam them all alone and also you get 100%`
        );
      }

      let dmMsg = 'Please verify so we can pull you to another server if we get termed.';
      if (setup.verificationLink) dmMsg += `\n${setup.verificationLink}`;
      else dmMsg += '\n(No verification link provided in setup)';

      try {
        await interaction.user.send(dmMsg);
        await interaction.reply({ content: 'Check your DMs for verification!', ephemeral: true });
      } catch {
        await interaction.reply({ content: 'Could not DM you — enable DMs from server members.', ephemeral: true });
      }
    }

    if (interaction.customId === 'not_interested_hitter') {
      await interaction.reply({ content: `**${interaction.user} was not interested**, we will be kicking you in 1 hour.\nIf you change your mind, click **Join Us**!`, ephemeral: false });
    }

    if (interaction.customId === 'claim_ticket') {
      if (ticket.claimedBy) return interaction.reply({ content: 'Already claimed.', ephemeral: true });
      if (!interaction.member.roles.cache.has(String(setup.middlemanRole || '')) && !interaction.member.roles.cache.has(String(setup.indexMiddlemanRole || ''))) {
        return interaction.reply({ content: 'Only middlemen or index middlemen can claim.', ephemeral: true });
      }

      ticket.claimedBy = interaction.user.id;
      saveData();
      await updateTicketPerms(interaction.channel, ticket, setup);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('unclaim_ticket').setLabel('Unclaim').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Secondary)
      );

      await interaction.update({
        content: `**${interaction.user} has claimed ticket**`,
        components: [row]
      });
    }

    if (interaction.customId === 'unclaim_ticket') {
      const isOwner = interaction.user.id === BOT_OWNER_ID;
      if (!ticket.claimedBy) return interaction.reply({ content: 'Not claimed.', ephemeral: true });
      if (ticket.claimedBy !== interaction.user.id && !isOwner) {
        return interaction.reply({ content: 'Only the claimer or bot owner can unclaim this ticket.', ephemeral: true });
      }

      ticket.claimedBy = null;
      saveData();
      await updateTicketPerms(interaction.channel, ticket, setup);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Secondary)
      );

      await interaction.update({
        content: `**${interaction.user} has unclaimed the ticket**`,
        components: [row]
      });
    }

    if (interaction.customId === 'close_ticket') {
      const isOwner = interaction.user.id === BOT_OWNER_ID;
      if (!ticket.claimedBy && !interaction.member.roles.cache.has(String(setup.coOwnerRole || '')) && !isOwner) {
        return interaction.reply({ content: 'Only claimer, co-owner or bot owner can close.', ephemeral: true });
      }

      const msgs = await interaction.channel.messages.fetch({ limit: 100 });
      const transcript = msgs.reverse().map(m => `[${m.createdAt.toLocaleString('en-GB', { timeZone: 'Europe/London' })}] ${m.author.tag}: ${m.content || '[Media/Embed]'}`).join('\n');

      const chan = interaction.guild.channels.cache.get(setup.transcriptsChannel);
      if (chan) {
        const transcriptEmbed = new EmbedBuilder()
          .setColor(0x2f3136)
          .setTitle(`Transcript: ${interaction.channel.name}`)
          .setDescription(
            `**Created by:** <@${ticket.opener}>\n` +
            `**Claimed by:** ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Nobody'}\n` +
            `**Closed by:** <@${interaction.user.id}>\n` +
            `**Date:** ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'short' })}`
          )
          .setFooter({ text: 'Roblox Trading Core • Middleman Logs' })
          .setTimestamp();

        await chan.send({
          embeds: [transcriptEmbed],
          files: [{
            attachment: Buffer.from(transcript, 'utf-8'),
            name: `${interaction.channel.name}-transcript.txt`
          }]
        });
      }

      await interaction.reply('Closing ticket...');
      await interaction.channel.delete();
    }
  }

  if (interaction.isModalSubmit()) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const isIndex = interaction.customId === 'index_modal';
    const isSeller = interaction.customId === 'seller_modal';
    const isShop = interaction.customId === 'shop_modal';
    const middlemanRole = isIndex ? setup.indexMiddlemanRole : setup.middlemanRole;

    const overwrites = [
      { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
    ];

    if (isSeller || isShop) {
      if (setup.coOwnerRole) {
        overwrites.push({
          id: setup.coOwnerRole,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
        });
      }
    } else {
      if (middlemanRole) {
        overwrites.push({
          id: middlemanRole,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory],
          deny: [PermissionsBitField.Flags.SendMessages]
        });
      }
    }

    if (setup.coOwnerRole) {
      overwrites.push({
        id: setup.coOwnerRole,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
      });
    }

    try {
      const channel = await interaction.guild.channels.create({
        name: `${isShop ? 'shop' : (isSeller ? 'seller' : (isIndex ? 'index' : 'ticket'))}-${interaction.user.username.toLowerCase()}`,
        type: ChannelType.GuildText,
        parent: setup.ticketCategory || undefined,
        permissionOverwrites: overwrites
      });

      data.tickets[channel.id] = {
        opener: interaction.user.id,
        claimedBy: null,
        addedUsers: [],
        isIndexTicket: isIndex,
        isSellerTicket: isSeller,
        isShopTicket: isShop
      };
      saveData();

      const welcomeEmbed = new EmbedBuilder()
        .setColor(0x0088ff)
        .setTitle(isShop ? 'Shop Purchase Request' : (isSeller ? 'Role Purchase Request' : (isIndex ? 'Index Requesting' : 'Welcome to your Ticket!')))
        .setDescription(
          isShop
            ? `Hello **${interaction.user}**! Your shop purchase request has been created.\n\n**A co-owner will respond shortly.**\nPlease be patient.`
            : (isSeller
              ? `Hello **${interaction.user}**! Your role purchase request has been created.\n\n**A co-owner will respond shortly.**\nPlease be patient.`
              : (isIndex
                ? `Hello! A <@&${middlemanRole || 'No middleman role'}> will reply to you soon.\n\n**Read our rules before proceeding with the ticket**\n• Be patient\n• Get payment ready\n• Do not waste time`
                : `Hello **${interaction.user}**, thanks for opening a Middleman Ticket!\n\nA staff member will assist you shortly.\nProvide all trade details clearly.\n**Fake/troll tickets will result in consequences.**`
              )
            )
        );

      if (isShop) {
        welcomeEmbed.addFields(
          { name: 'Product', value: interaction.fields.getTextInputValue('product') || 'Not provided' },
          { name: 'Quantity', value: interaction.fields.getTextInputValue('quantity') || 'Not provided' },
          { name: 'Payment method', value: interaction.fields.getTextInputValue('payment_method') || 'Not provided' }
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
      } else {
        welcomeEmbed.addFields({
          name: 'Trade Details:',
          value: `**Other User or ID:** <@${interaction.fields.getTextInputValue('other_id') || 'Not provided'}>\n**Can you join private servers:** ${interaction.fields.getTextInputValue('private_servers') || 'Not provided'}`
        });
      }

      const pingRole = isShop || isSeller ? setup.coOwnerRole : middlemanRole;
      await channel.send({
        content: pingRole ? `<@&${pingRole}> New ${isShop ? 'shop' : (isSeller ? 'seller' : (isIndex ? 'index' : 'ticket'))}!` : 'New ticket created!',
        embeds: [welcomeEmbed]
      });

      await interaction.editReply(`Ticket created → ${channel}`);
    } catch (err) {
      console.error('Ticket creation error:', err);
      await interaction.editReply('Failed to create ticket. Bot needs Manage Channels & Manage Permissions.');
    }
  }
});

client.login(process.env.TOKEN);
