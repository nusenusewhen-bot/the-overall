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
    console.error('Error loading data.json:', err);
  }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error saving data.json:', err);
  }
}

const validKeys = config.validKeys;

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Helper: ask one question
async function askQuestion(channel, userId, question) {
  await channel.send(question);
  const filter = m => m.author.id === userId && !m.author.bot;
  const collector = channel.createMessageCollector({ filter, max: 1, time: 120000 });

  return new Promise((resolve) => {
    collector.on('collect', m => resolve({ content: m.content.trim(), message: m }));
    collector.on('end', (collected, reason) => {
      if (reason === 'time') {
        channel.send('Timed out waiting for answer. Setup cancelled.');
        resolve(null);
      }
    });
  });
}

// Update permissions in ticket channel
async function updateTicketPerms(channel, ticket, setup) {
  if (setup.middlemanRole) {
    await channel.permissionOverwrites.edit(setup.middlemanRole, {
      SendMessages: ticket.claimedBy ? false : null
    });
  }
  await channel.permissionOverwrites.edit(ticket.opener, { SendMessages: true });
  if (ticket.claimedBy) {
    await channel.permissionOverwrites.edit(ticket.claimedBy, { SendMessages: true });
  }
  for (const uid of ticket.addedUsers) {
    await channel.permissionOverwrites.edit(uid, { SendMessages: true });
  }
  if (setup.helperRole) await channel.permissionOverwrites.edit(setup.helperRole, { SendMessages: true });
  if (setup.coOwnerRole) await channel.permissionOverwrites.edit(setup.coOwnerRole, { SendMessages: true });
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const userId = message.author.id;
  const guildId = message.guild.id;
  const userModeData = data.userModes[userId];

  if (!data.guilds[guildId]) data.guilds[guildId] = { setup: {} };
  const setup = data.guilds[guildId].setup;

  // Handle mode selection after redeem
  if (userModeData && userModeData.mode === null) {
    const content = message.content.trim();
    if (content === '1' || content === '2') {
      userModeData.mode = content === '1' ? 'ticket' : 'middleman';
      saveData();
      return message.reply(`**${userModeData.mode.charAt(0).toUpperCase() + userModeData.mode.slice(1)} mode activated!**\nUse $shazam to setup, $ticket1 to post panel.`);
    }
  }

  if (!message.content.startsWith(config.prefix)) return;

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // $redeem
  if (command === 'redeem') {
    if (args.length < 1) return message.reply('Usage: $redeem <key>');
    const key = args[0];
    if (!validKeys[key]) return message.reply('Invalid key.');
    if (data.usedKeys.includes(key)) return message.reply('Key already used.');
    const type = validKeys[key];
    data.usedKeys.push(key);
    data.userModes[userId] = { mode: null, type, redeemDate: Date.now() };
    saveData();
    return message.reply(`**${type} key activated.**\nChoose 1. Ticket bot | 2. Middleman bot\n(Reply with 1 or 2)`);
  }

  // $shazam setup wizard
  if (command === 'shazam') {
    if (!userModeData || userModeData.mode === null) return message.reply('Redeem a key and choose mode first.');
    await message.reply('Starting setup. Answer each question. Type "cancel" to stop.');

    let answer;
    answer = await askQuestion(message.channel, userId, 'Ticket Transcripts channel id.');
    if (!answer || answer.content.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.transcriptsChannel = answer.content;

    answer = await askQuestion(message.channel, userId, 'Middleman role (ID)');
    if (!answer || answer.content.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.middlemanRole = answer.content;

    answer = await askQuestion(message.channel, userId, 'Helper role (ID)');
    if (!answer || answer.content.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.helperRole = answer.content;

    let linkValid = false;
    while (!linkValid) {
      answer = await askQuestion(message.channel, userId, 'Verification link (must start with https://)');
      if (!answer || answer.content.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
      if (answer.content.startsWith('https://')) {
        setup.verificationLink = answer.content;
        linkValid = true;
      } else {
        await message.channel.send('Must start with https://. Try again.');
      }
    }

    answer = await askQuestion(message.channel, userId, 'Guide channel id.');
    if (!answer || answer.content.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.guideChannel = answer.content;

    answer = await askQuestion(message.channel, userId, 'Co owner role id.');
    if (!answer || answer.content.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.coOwnerRole = answer.content;

    saveData();
    return message.channel.send('**Setup complete!** You can now use $ticket1');
  }

  // $ticket1 - post panel
  if (command === 'ticket1') {
    if (!userModeData || userModeData.mode !== 'ticket') return message.reply('Ticket mode not activated.');

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
      .setImage('attachment://banner.png')
      .setFooter({ text: 'Safe Trading Server' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('request_ticket')
        .setLabel('Request')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📩')
    );

    await message.channel.send({ embeds: [embed], components: [row], files: ['./banner.png'] });
  }

  // Ticket channel commands
  const ticket = data.tickets[message.channel.id];
  if (ticket) {
    const isMiddleman = message.member.roles.cache.has(setup.middlemanRole);
    const isClaimed = message.author.id === ticket.claimedBy;
    const isCoOwner = message.member.roles.cache.has(setup.coOwnerRole);
    const hasPerm = isMiddleman || isClaimed || isCoOwner;

    if (command === 'add') {
      if (!hasPerm) return message.reply('Only middleman/co-owner can use this.');
      const target = message.mentions.users.first() || client.users.cache.get(args[0]);
      if (!target) return message.reply('Usage: $add @user or ID');
      if (ticket.addedUsers.includes(target.id)) return message.reply('Already added.');
      ticket.addedUsers.push(target.id);
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      return message.reply(`Added ${target}.`);
    }

    if (command === 'transfer') {
      if (!hasPerm) return message.reply('Only middleman/co-owner can use this.');
      const target = message.mentions.users.first() || client.users.cache.get(args[0]);
      if (!target) return message.reply('Usage: $transfer @user or ID');
      if (!message.guild.members.cache.get(target.id)?.roles.cache.has(setup.middlemanRole)) {
        return message.reply('Target must have middleman role.');
      }
      ticket.claimedBy = target.id;
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      return message.reply(`Transferred to ${target}.`);
    }

    if (command === 'close') {
      if (!isClaimed && !isCoOwner) return message.reply('Only claimed middleman or co-owner can close.');
      const msgs = await message.channel.messages.fetch({ limit: 100 });
      const transcript = msgs.reverse().map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || '[attachment]'}`).join('\n');
      const chan = message.guild.channels.cache.get(setup.transcriptsChannel);
      if (chan) await chan.send(`**Transcript: ${message.channel.name}**\n\`\`\`\n${transcript.slice(0, 1900)}\n\`\`\``);
      await message.reply('Closing ticket...');
      await message.channel.delete();
    }
  }
});

// Button interactions
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

    ['middlemanRole', 'helperRole', 'coOwnerRole'].forEach(roleKey => {
      if (setup[roleKey]) {
        overwrites.push({
          id: setup[roleKey],
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
        });
      }
    });

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
      content: `Welcome ${interaction.user}!\nPlease describe your trade.\nVerification: ${setup.verificationLink || 'Not set'}\nGuide: <#${setup.guideChannel || 'Not set'}>`,
      components: [row]
    });

    await updateTicketPerms(channel, data.tickets[channel.id], setup);

    await interaction.editReply(`Ticket created → ${channel}`);
  }

  // Ticket control buttons
  if (['claim_ticket','unclaim_ticket','close_ticket','transfer_ticket','add_ticket'].includes(interaction.customId)) {
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
      await interaction.editReply('Claimed!');
    }

    else if (interaction.customId === 'unclaim_ticket') {
      if (!ticket.claimedBy) return interaction.editReply('Not claimed.');
      if (ticket.claimedBy !== interaction.user.id && !isCoOwner) return interaction.editReply('Only claimer or co-owner can unclaim.');
      ticket.claimedBy = null;
      saveData();
      await updateTicketPerms(interaction.channel, ticket, setup);
      await interaction.editReply('Unclaimed.');
    }

    else if (interaction.customId === 'close_ticket') {
      if (ticket.claimedBy !== interaction.user.id && !isCoOwner) return interaction.editReply('Only claimer or co-owner can close.');
      const msgs = await interaction.channel.messages.fetch({ limit: 100 });
      const transcript = msgs.reverse().map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || '[attachment]'}`).join('\n');
      const chan = interaction.guild.channels.cache.get(setup.transcriptsChannel);
      if (chan) await chan.send(`**Transcript: ${interaction.channel.name}**\n\`\`\`\n${transcript.slice(0, 1900)}\n\`\`\``);
      await interaction.editReply('Closing...');
      await interaction.channel.delete();
    }

    else if (interaction.customId === 'add_ticket') {
      await interaction.editReply('Use command: `$add @user` or `$add ID`\n(Only middleman/co-owner can add users)');
    }

    else if (interaction.customId === 'transfer_ticket') {
      await interaction.editReply('Use command: `$transfer @user` or `$transfer ID`\n(Target must have middleman role)');
    }
  }
});

client.login(process.env.TOKEN);
