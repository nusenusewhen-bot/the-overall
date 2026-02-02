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
  const collector = channel.createMessageCollector({ filter, max: 1, time: 120000 });
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

  // AFK auto-remove on any message
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

  // Block pings to AFK users
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
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.hitterRole = ans;

    let valid = false;
    while (!valid) {
      ans = await askQuestion(message.channel, userId, 'Verification link (must start with https://):');
      if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
      if (ans.startsWith('https://')) {
        setup.verificationLink = ans;
        valid = true;
      } else {
        await message.channel.send('Link must start with **https://**. Try again.');
      }
    }

    ans = await askQuestion(message.channel, userId, 'Guide channel ID:');
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.guideChannel = ans;

    ans = await askQuestion(message.channel, userId, 'Co-owner role ID:');
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.coOwnerRole = ans;

    saveData();
    return message.channel.send('**Setup complete!** Use $ticket1 or $schior.');
  }

  if (cmd === 'ticket1') {
    if (!isTicketUser(userId)) return message.reply('Ticket mode required.');
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

    try {
      await message.channel.send({ embeds: [embed], components: [row] });
    } catch (err) {
      console.error('Failed to send panel:', err.message);
      await message.reply('Failed to send the panel. Check bot permissions.');
    }
  }

  const ticket = data.tickets[message.channel.id];
  if (ticket) {
    const isMM = message.member.roles.cache.has(setup.middlemanRole);
    const isClaimed = message.author.id === ticket.claimedBy;
    const isCo = message.member.roles.cache.has(setup.coOwnerRole);
    const canManage = isMM || isClaimed || isCo;

    if (cmd === 'claim') {
      if (!isMM) return message.reply('Only middlemen can claim.');
      if (ticket.claimedBy) return message.reply('Already claimed.');
      ticket.claimedBy = userId;
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      return message.channel.send(`**${message.author} has claimed ticket**`);
    }

    if (cmd === 'unclaim') {
      if (!isMM && !isCo) return message.reply('Only middlemen or co-owners can unclaim.');
      if (!ticket.claimedBy) return message.reply('Not claimed.');
      if (ticket.claimedBy !== userId && !isCo) return message.reply('Only claimer or co-owner can unclaim.');
      ticket.claimedBy = null;
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      return message.channel.send(`**${message.author} has unclaimed the ticket**`);
    }

    if (cmd === 'close') {
      if (!isClaimed && !isCo) return message.reply('Only claimer or co-owner can close.');
      const msgs = await message.channel.messages.fetch({ limit: 100 });
      const transcript = msgs.reverse().map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || '[Media]'}`).join('\n');
      const chan = message.guild.channels.cache.get(setup.transcriptsChannel);
      if (chan) await chan.send(`**Transcript: ${message.channel.name}**\n\`\`\`\n${transcript.slice(0, 1900)}\n\`\`\``);
      await message.reply('Closing ticket...');
      await message.channel.delete();
    }

    if (cmd === 'add') {
      if (!canManage) return message.reply('Only middlemen and co-owners can add users.');
      const target = message.mentions.users.first() || client.users.cache.get(args[0]);
      if (!target) return message.reply('Usage: $add @user or $add ID');
      if (ticket.addedUsers.includes(target.id)) return message.reply('Already added.');
      ticket.addedUsers.push(target.id);
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      return message.reply(`Added ${target}.`);
    }

    if (cmd === 'transfer') {
      if (!canManage) return message.reply('Only middlemen/co-owners can transfer.');
      const target = message.mentions.users.first() || client.users.cache.get(args[0]);
      if (!target) return message.reply('Usage: $transfer @user or ID');
      if (!message.guild.members.cache.get(target.id)?.roles.cache.has(setup.middlemanRole)) return message.reply('Target must have middleman role.');
      ticket.claimedBy = target.id;
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      return message.reply(`Transferred to ${target}.`);
    }
  }

  if (cmd === 'schior') {
    if (!isMiddlemanUser(userId)) return message.reply('Middleman mode required.');
    const embed = new EmbedBuilder()
      .setColor(0x000000)
      .setTitle('Want to join us?')
      .setDescription(
        `You just got scammed! Wanna be a hitter like us? 😈\n\n` +
        `1. You find victim in trading server (for eg: ADM, MM2, PSX ETC.)\n` +
        `2. You get the victim to use our middleman service's\n` +
        `3. Then the middleman will help you scam the item CRYPTPO/ROBUX/INGAME ETC.\n` +
        `4. Once done the middleman and you split the item 50/50\n\n` +
        `Be sure to check the guide channel for everything you need to know.`
      )
      .addFields({
        name: 'STAFF IMPORTANT',
        value: 'If you\'re ready, click the button below to start and join the team!'
      })
      .setFooter({ text: 'You have 1 hour to click \'Join Us\' or you will be kicked!' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('join_hitter').setLabel('Join Us').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('not_interested_hitter').setLabel('Not Interested').setStyle(ButtonStyle.Danger)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
  }

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

    if (interaction.customId === 'join_hitter') {
      const member = interaction.member;
      if (!member.roles.cache.has(setup.hitterRole) && setup.hitterRole) {
        await member.roles.add(setup.hitterRole);
      }
      await interaction.message.edit({
        content: `**${interaction.user} joined the team!** 🎉`,
        embeds: [],
        components: []
      });
    }

    if (interaction.customId === 'not_interested_hitter') {
      const member = interaction.member;
      if (member.roles.cache.has(setup.hitterRole)) {
        await interaction.message.edit({
          content: `**${interaction.user} is not interested — already a hitter.**`,
          embeds: [],
          components: []
        });
      } else {
        await member.kick('Not interested in hitter recruitment');
        await interaction.message.edit({
          content: `**${interaction.user} was kicked for not being interested.**`,
          embeds: [],
          components: []
        });
      }
    }
  }

  if (interaction.isModalSubmit() && interaction.customId === 'ticket_modal') {
    await interaction.deferReply({ ephemeral: true });

    const otherId = interaction.fields.getTextInputValue('other_id') || 'Not provided';
    const tradeDesc = interaction.fields.getTextInputValue('trade_desc') || 'Not provided';
    const privateServers = interaction.fields.getTextInputValue('private_servers') || 'Not provided';

    const overwrites = [
      { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
    ];

    if (setup.middlemanRole) overwrites.push({ id: setup.middlemanRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
    if (setup.hitterRole) overwrites.push({ id: setup.hitterRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
    if (setup.coOwnerRole) overwrites.push({ id: setup.coOwnerRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });

    const channel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username.toLowerCase()}`,
      type: ChannelType.GuildText,
      parent: interaction.channel.parentId,
      permissionOverwrites: overwrites
    });

    data.tickets[channel.id] = { opener: interaction.user.id, claimedBy: null, addedUsers: [], confirmVotes: {}, feeVotes: {} };
    saveData();

    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x0088ff)
      .setTitle('Welcome to your Ticket!')
      .setDescription(
        `Hello **${interaction.user}**, thanks for opening a Middleman Ticket!\n\n` +
        `A staff member will assist you shortly.\n` +
        `Provide all trade details clearly.\n` +
        `**Fake/troll tickets will result in consequences.**\n\n` +
        `• If ticket is unattended for 1 hour it will be closed.`
      )
      .addFields({
        name: 'Trade Details:',
        value: `**Other User or ID:** <@${otherId}>\n**Can you join private servers:** ${privateServers}`
      });

    await channel.send({
      content: `<@&${setup.middlemanRole || 'No middleman role'}> New ticket!`,
      embeds: [welcomeEmbed]
    });

    await interaction.editReply(`Ticket created → ${channel}`);
  }
});

client.login(process.env.TOKEN);
