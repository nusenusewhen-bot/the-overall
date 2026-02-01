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

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Ask one question during setup
async function askQuestion(channel, userId, question) {
  await channel.send(question);
  const filter = m => m.author.id === userId && !m.author.bot;
  const collector = channel.createMessageCollector({ filter, max: 1, time: 120000 });
  return new Promise(resolve => {
    collector.on('collect', m => resolve({ content: m.content.trim() }));
    collector.on('end', (c, r) => {
      if (r === 'time') {
        channel.send('Timed out. Setup cancelled.');
        resolve(null);
      }
    });
  });
}

// Update ticket permissions after claim/unclaim/add/transfer
async function updateTicketPerms(channel, ticket, setup) {
  if (setup.middlemanRole) {
    await channel.permissionOverwrites.edit(setup.middlemanRole, {
      SendMessages: ticket.claimedBy ? false : null
    });
  }
  await channel.permissionOverwrites.edit(ticket.opener, { SendMessages: true });
  if (ticket.claimedBy) await channel.permissionOverwrites.edit(ticket.claimedBy, { SendMessages: true });
  ticket.addedUsers.forEach(uid => channel.permissionOverwrites.edit(uid, { SendMessages: true }));
  if (setup.helperRole) await channel.permissionOverwrites.edit(setup.helperRole, { SendMessages: true });
  if (setup.coOwnerRole) await channel.permissionOverwrites.edit(setup.coOwnerRole, { SendMessages: true });
}

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;
  const userId = message.author.id;
  const guildId = message.guild.id;
  if (!data.guilds[guildId]) data.guilds[guildId] = { setup: {} };
  const setup = data.guilds[guildId].setup;
  const userMode = data.userModes[userId];

  // Mode choice after redeem
  if (userMode && userMode.mode === null) {
    const c = message.content.trim();
    if (c === '1' || c === '2') {
      userMode.mode = c === '1' ? 'ticket' : 'middleman';
      saveData();
      return message.reply(`**${userMode.mode} mode activated!**\nUse $shazam to setup.`);
    }
  }

  if (!message.content.startsWith(config.prefix)) return;
  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  // $redeem
  if (cmd === 'redeem') {
    if (!args[0]) return message.reply('Usage: $redeem <key>');
    const key = args[0];
    if (!config.validKeys[key]) return message.reply('Invalid key.');
    if (data.usedKeys.includes(key)) return message.reply('Key already used.');
    const type = config.validKeys[key];
    data.usedKeys.push(key);
    data.userModes[userId] = { mode: null, type, redeemDate: Date.now() };
    saveData();
    return message.reply(`**${type} key activated.** Reply with 1 (Ticket bot) or 2 (Middleman bot)`);
  }

  // $shazam setup
  if (cmd === 'shazam') {
    if (!userMode || userMode.mode === null) return message.reply('Redeem & choose mode first.');
    await message.reply('Setup started. Answer each question. Type "cancel" to stop.');

    let a;
    a = await askQuestion(message.channel, userId, 'Ticket Transcripts channel id');
    if (!a || a.content.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.transcriptsChannel = a.content;

    a = await askQuestion(message.channel, userId, 'Middleman role ID');
    if (!a || a.content.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.middlemanRole = a.content;

    a = await askQuestion(message.channel, userId, 'Helper role ID');
    if (!a || a.content.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.helperRole = a.content;

    let validLink = false;
    while (!validLink) {
      a = await askQuestion(message.channel, userId, 'Verification link (must start with https://)');
      if (!a || a.content.toLowerCase() === 'cancel') return message.reply('Cancelled.');
      if (a.content.startsWith('https://')) {
        setup.verificationLink = a.content;
        validLink = true;
      } else {
        await message.channel.send('Link must start with https://. Try again.');
      }
    }

    a = await askQuestion(message.channel, userId, 'Guide channel id');
    if (!a || a.content.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.guideChannel = a.content;

    a = await askQuestion(message.channel, userId, 'Co-owner role ID');
    if (!a || a.content.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.coOwnerRole = a.content;

    saveData();
    return message.channel.send('**Setup finished.** Use $ticket1 to post the panel.');
  }

  // $ticket1 – post panel
  if (cmd === 'ticket1') {
    if (!userMode || userMode.mode !== 'ticket') return message.reply('Ticket mode not activated.');

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

  // Ticket commands ($add, $transfer, $close)
  const ticket = data.tickets[message.channel.id];
  if (ticket) {
    const isMM = message.member.roles.cache.has(setup.middlemanRole);
    const isClaimed = message.author.id === ticket.claimedBy;
    const isCo = message.member.roles.cache.has(setup.coOwnerRole);
    const canManage = isMM || isClaimed || isCo;

    if (cmd === 'add') {
      if (!canManage) return message.reply('Only middleman/co-owner can add.');
      const target = message.mentions.users.first() || message.guild.members.cache.get(args[0])?.user;
      if (!target) return message.reply('Usage: $add @user or ID');
      if (ticket.addedUsers.includes(target.id)) return message.reply('Already added.');
      ticket.addedUsers.push(target.id);
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      return message.reply(`Added ${target}.`);
    }

    if (cmd === 'transfer') {
      if (!canManage) return message.reply('Only middleman/co-owner can transfer.');
      const target = message.mentions.users.first() || message.guild.members.cache.get(args[0])?.user;
      if (!target) return message.reply('Usage: $transfer @user or ID');
      if (!message.guild.members.cache.get(target.id)?.roles.cache.has(setup.middlemanRole)) {
        return message.reply('Target must have middleman role.');
      }
      ticket.claimedBy = target.id;
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      return message.reply(`Transferred to ${target}.`);
    }

    if (cmd === 'close') {
      if (!isClaimed && !isCo) return message.reply('Only claimed middleman or co-owner can close.');
      const msgs = await message.channel.messages.fetch({ limit: 100 });
      const log = msgs.reverse().map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || '[media]'}`).join('\n');
      const transcripts = message.guild.channels.cache.get(setup.transcriptsChannel);
      if (transcripts) await transcripts.send(`**Transcript: ${message.channel.name}**\n\`\`\`\n${log.slice(0, 1900)}\n\`\`\``);
      await message.reply('Closing ticket...');
      await message.channel.delete();
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

    ['middlemanRole','helperRole','coOwnerRole'].forEach(k => {
      if (setup[k]) overwrites.push({
        id: setup[k],
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory]
      });
    });

    const ch = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username.toLowerCase()}`,
      type: ChannelType.GuildText,
      parent: interaction.channel.parentId,
      permissionOverwrites: overwrites
    });

    data.tickets[ch.id] = { opener: interaction.user.id, claimedBy: null, addedUsers: [] };
    saveData();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('unclaim_ticket').setLabel('Unclaim').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('transfer_ticket').setLabel('Transfer').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('add_ticket').setLabel('Add').setStyle(ButtonStyle.Primary)
    );

    await ch.send({
      content: `Welcome ${interaction.user}!\nDescribe your trade.\nVerification: ${setup.verificationLink || 'N/A'}\nGuide: <#${setup.guideChannel || 'N/A'}>`,
      components: [row]
    });

    await updateTicketPerms(ch, data.tickets[ch.id], setup);

    await interaction.editReply(`Ticket: ${ch}`);
  }

  // Control buttons
  if (['claim_ticket','unclaim_ticket','close_ticket','transfer_ticket','add_ticket'].includes(interaction.customId)) {
    if (!ticket) return interaction.reply({ content: 'Not a ticket.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });

    const m = interaction.member;
    const isMM = m.roles.cache.has(setup.middlemanRole);
    const isCo = m.roles.cache.has(setup.coOwnerRole);

    if (interaction.customId === 'claim_ticket') {
      if (ticket.claimedBy) return interaction.editReply('Already claimed.');
      if (!isMM) return interaction.editReply('Only middlemen can claim.');
      ticket.claimedBy = interaction.user.id;
      saveData();
      await updateTicketPerms(interaction.channel, ticket, setup);
      await interaction.editReply('Claimed!');
    }

    else if (interaction.customId === 'unclaim_ticket') {
      if (!ticket.claimedBy) return interaction.editReply('Not claimed.');
      if (ticket.claimedBy !== interaction.user.id && !isCo) return interaction.editReply('Only claimer or co-owner can unclaim.');
      ticket.claimedBy = null;
      saveData();
      await updateTicketPerms(interaction.channel, ticket, setup);
      await interaction.editReply('Unclaimed.');
    }

    else if (interaction.customId === 'close_ticket') {
      if (ticket.claimedBy !== interaction.user.id && !isCo) return interaction.editReply('Only claimer or co-owner can close.');
      const msgs = await interaction.channel.messages.fetch({ limit: 100 });
      const log = msgs.reverse().map(m => `[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content || '[media]'}`).join('\n');
      const tc = interaction.guild.channels.cache.get(setup.transcriptsChannel);
      if (tc) await tc.send(`**Transcript: ${interaction.channel.name}**\n\`\`\`\n${log.slice(0, 1900)}\n\`\`\``);
      await interaction.editReply('Closing...');
      await interaction.channel.delete();
    }

    else if (interaction.customId === 'add_ticket') {
      await interaction.editReply('Command: `$add @user` or `$add ID`');
    }

    else if (interaction.customId === 'transfer_ticket') {
      await interaction.editReply('Command: `$transfer @user` or `$transfer ID` (must be middleman)');
    }
  }
});

client.login(process.env.TOKEN);
