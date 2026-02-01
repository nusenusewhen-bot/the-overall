const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } = require('discord.js');
const fs = require('fs');

const config = require('./config.json');
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const DATA_FILE = './data.json';
let data = { usedKeys: [], userModes: {}, guilds: {}, tickets: {} };

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

client.once('ready', () => {
  console.log(`Bot online → ${client.user.tag} | ${client.guilds.cache.size} servers`);
});

async function askQuestion(channel, userId, question) {
  await channel.send(question);
  const filter = m => m.author.id === userId && !m.author.bot;
  const collector = channel.createMessageCollector({ filter, max: 1, time: 120_000 });

  return new Promise(resolve => {
    collector.on('collect', m => resolve(m.content.trim()));
    collector.on('end', (collected, reason) => {
      if (reason === 'time') {
        channel.send('Timed out (2 minutes). Run $shazam again if needed.');
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
    if (ticket.claimedBy) {
      await channel.permissionOverwrites.edit(ticket.claimedBy, { SendMessages: true });
    }
    ticket.addedUsers.forEach(uid => {
      channel.permissionOverwrites.edit(uid, { SendMessages: true }).catch(() => {});
    });
    if (setup.helperRole) await channel.permissionOverwrites.edit(setup.helperRole, { SendMessages: true });
    if (setup.coOwnerRole) await channel.permissionOverwrites.edit(setup.coOwnerRole, { SendMessages: true });
  } catch (err) {
    console.error('Permission update failed:', err.message);
  }
}

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  const userId = message.author.id;
  const guildId = message.guild.id;
  if (!data.guilds[guildId]) data.guilds[guildId] = { setup: {} };
  const setup = data.guilds[guildId].setup;
  const userMode = data.userModes[userId];

  // Handle mode choice (just reply 1 or 2)
  if (userMode && userMode.mode === null) {
    const content = message.content.trim();
    if (content === '1' || content === '2') {
      userMode.mode = content === '1' ? 'ticket' : 'middleman';
      saveData();
      return message.reply(`**${userMode.mode} mode activated!**\nUse **$shazam** to configure the server.`);
    }
  }

  if (!message.content.startsWith(config.prefix)) return;

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  // $redeem
  if (cmd === 'redeem') {
    if (!args[0]) return message.reply('Usage: $redeem <key>');
    const key = args[0];
    if (!config.validKeys[key]) return message.reply('Invalid or unknown key.');
    if (data.usedKeys.includes(key)) return message.reply('This key has already been redeemed.');
    const type = config.validKeys[key];
    data.usedKeys.push(key);
    data.userModes[userId] = { mode: null, type, redeemDate: Date.now() };
    saveData();
    return message.reply(`**${type} key activated successfully!**\nReply with **1** for Ticket bot\nReply with **2** for Middleman bot`);
  }

  // $shazam setup
  if (cmd === 'shazam') {
    if (!userMode || userMode.mode === null) return message.reply('You must redeem a key and select a mode first.');
    if (userMode.type === '3months') {
      const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
      if (Date.now() > userMode.redeemDate + THREE_MONTHS_MS) {
        delete data.userModes[userId];
        saveData();
        return message.reply('Your 3-month key has expired. Please redeem a new one.');
      }
    }

    await message.reply('Setup started. Answer each question below. Type **cancel** to stop.');

    let ans;
    ans = await askQuestion(message.channel, userId, 'Ticket transcripts channel ID:');
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.transcriptsChannel = ans;

    ans = await askQuestion(message.channel, userId, 'Middleman role ID:');
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.middlemanRole = ans;

    ans = await askQuestion(message.channel, userId, 'Helper role ID:');
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.helperRole = ans;

    let valid = false;
    while (!valid) {
      ans = await askQuestion(message.channel, userId, 'Verification link (must start with https://):');
      if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
      if (ans.startsWith('https://')) {
        setup.verificationLink = ans;
        valid = true;
      } else {
        await message.channel.send('Link must start with **https://**. Please try again.');
      }
    }

    ans = await askQuestion(message.channel, userId, 'Guide channel ID:');
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.guideChannel = ans;

    ans = await askQuestion(message.channel, userId, 'Co-owner role ID:');
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.coOwnerRole = ans;

    saveData();
    return message.channel.send('✅ **Setup finished successfully!**\nYou can now use `$ticket1` to post the panel.');
  }

  // $ticket1 – post panel
  if (cmd === 'ticket1') {
    if (!userMode || userMode.mode !== 'ticket') {
      return message.reply('You need to activate **ticket** mode first (redeem key → choose 1).');
    }

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

  // Commands inside ticket channels
  const ticket = data.tickets[message.channel.id];
  if (ticket) {
    const isMM = message.member.roles.cache.has(setup.middlemanRole);
    const isClaimed = message.author.id === ticket.claimedBy;
    const isCo = message.member.roles.cache.has(setup.coOwnerRole);
    const canManage = isMM || isClaimed || isCo;

    if (cmd === 'add') {
      if (!canManage) return message.reply('Only middlemen and co-owners can add users.');
      const target = message.mentions.users.first() || client.users.cache.get(args[0]);
      if (!target) return message.reply('Usage: $add @user or $add ID');
      if (ticket.addedUsers.includes(target.id)) return message.reply('User is already added.');
      ticket.addedUsers.push(target.id);
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      return message.reply(`Added **${target.tag}** to the ticket.`);
    }

    if (cmd === 'transfer') {
      if (!canManage) return message.reply('Only middlemen and co-owners can transfer tickets.');
      const target = message.mentions.users.first() || client.users.cache.get(args[0]);
      if (!target) return message.reply('Usage: $transfer @user or $transfer ID');
      const member = message.guild.members.cache.get(target.id);
      if (!member?.roles.cache.has(setup.middlemanRole)) {
        return message.reply('The target user must have the middleman role.');
      }
      ticket.claimedBy = target.id;
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      return message.reply(`Ticket transferred to **${target.tag}**.`);
    }

    if (cmd === 'close') {
      if (!isClaimed && !isCo) return message.reply('Only the claimed middleman or co-owner can close this ticket.');
      try {
        const msgs = await message.channel.messages.fetch({ limit: 100 });
        const transcript = msgs.reverse().map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || '[attachment]'}`).join('\n');
        const chan = message.guild.channels.cache.get(setup.transcriptsChannel);
        if (chan) {
          await chan.send(`**Transcript – ${message.channel.name}**\n\`\`\`\n${transcript.slice(0, 1900)}\n\`\`\``);
        }
        await message.reply('Closing ticket... Transcript sent.');
        await message.channel.delete();
      } catch (err) {
        console.error('Close error:', err.message);
        await message.reply('Could not close ticket properly.');
      }
    }
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const setup = data.guilds[interaction.guild.id]?.setup || {};
  const ticket = data.tickets[interaction.channel?.id];

  if (interaction.customId === 'request_ticket') {
    await interaction.deferReply({ ephemeral: true });

    const overwrites = [
      { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
    ];

    ['middlemanRole', 'helperRole', 'coOwnerRole'].forEach(role => {
      if (setup[role]) {
        overwrites.push({
          id: setup[role],
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
        });
      }
    });

    try {
      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username.toLowerCase()}`,
        type: ChannelType.GuildText,
        parent: interaction.channel.parentId,
        permissionOverwrites: overwrites
      });

      data.tickets[channel.id] = { opener: interaction.user.id, claimedBy: null, addedUsers: [] };
      saveData();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('unclaim_ticket').setLabel('Unclaim').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('transfer_ticket').setLabel('Transfer').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('add_ticket').setLabel('Add').setStyle(ButtonStyle.Primary)
      );

      await channel.send({
        content: `**Welcome ${interaction.user}!**\nPlease describe your trade (items, values, usernames, proof links, etc.)\n**Verification link:** ${setup.verificationLink || 'Not set'}\n**Guide channel:** <#${setup.guideChannel || 'Not set'}>`,
        components: [row]
      });

      await updateTicketPerms(channel, data.tickets[channel.id], setup);

      await interaction.editReply(`Ticket opened → ${channel}`);
    } catch (err) {
      console.error('Ticket creation error:', err.message);
      await interaction.editReply('Failed to create ticket channel. Check bot permissions.');
    }
  }

  // Ticket buttons
  if (['claim_ticket', 'unclaim_ticket', 'close_ticket', 'transfer_ticket', 'add_ticket'].includes(interaction.customId)) {
    if (!ticket) return interaction.reply({ content: 'Not a ticket channel.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });

    const member = interaction.member;
    const isMiddleman = member.roles.cache.has(setup.middlemanRole);
    const isCoOwner = member.roles.cache.has(setup.coOwnerRole);

    if (interaction.customId === 'claim_ticket') {
      if (ticket.claimedBy) return interaction.editReply('Already claimed.');
      if (!isMiddleman) return interaction.editReply('Only middlemen can claim.');
      ticket.claimedBy = interaction.user.id;
      saveData();
      await updateTicketPerms(interaction.channel, ticket, setup);
      await interaction.editReply('✅ Ticket claimed.');
    }

    else if (interaction.customId === 'unclaim_ticket') {
      if (!ticket.claimedBy) return interaction.editReply('Not claimed.');
      if (ticket.claimedBy !== interaction.user.id && !isCoOwner) {
        return interaction.editReply('Only the claimer or co-owner can unclaim.');
      }
      ticket.claimedBy = null;
      saveData();
      await updateTicketPerms(interaction.channel, ticket, setup);
      await interaction.editReply('Ticket unclaimed.');
    }

    else if (interaction.customId === 'close_ticket') {
      if (ticket.claimedBy !== interaction.user.id && !isCoOwner) {
        return interaction.editReply('Only the claimer or co-owner can close.');
      }
      try {
        const msgs = await interaction.channel.messages.fetch({ limit: 100 });
        const log = msgs.reverse().map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || '[media]'}`).join('\n');
        const tc = interaction.guild.channels.cache.get(setup.transcriptsChannel);
        if (tc) await tc.send(`**Transcript – ${interaction.channel.name}**\n\`\`\`\n${log.slice(0, 1900)}\n\`\`\``);
        await interaction.editReply('Closing ticket...');
        await interaction.channel.delete();
      } catch (err) {
        console.error('Close failed:', err.message);
        await interaction.editReply('Error while closing.');
      }
    }

    else if (interaction.customId === 'add_ticket') {
      await interaction.editReply('Use `$add @user` or `$add ID` to add someone.');
    }

    else if (interaction.customId === 'transfer_ticket') {
      await interaction.editReply('Use `$transfer @user` or `$transfer ID` to transfer (target must be middleman).');
    }
  }
});

client.login(process.env.TOKEN);
