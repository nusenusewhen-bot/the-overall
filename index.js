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
  userModes: {}, // { userId: { ticket: bool, middleman: bool } }
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

function hasTicketMode(userId) {
  return data.userModes[userId]?.ticket === true;
}

function hasMiddlemanMode(userId) {
  return data.userModes[userId]?.middleman === true;
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

  if (!data.userModes[userId]) data.userModes[userId] = { ticket: false, middleman: false };

  // AFK auto-remove
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

  // Block AFK pings
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
    if (data.userModes[userId] && (!data.userModes[userId].ticket || !data.userModes[userId].middleman)) {
      const content = message.content.trim().toLowerCase();
      if (content === '1' || content === 'ticket') {
        data.userModes[userId].ticket = true;
        saveData();
        return message.reply('**Ticket mode activated!** Use $shazam to setup.');
      }
      if (content === '2' || content === 'middleman') {
        data.userModes[userId].middleman = true;
        saveData();
        message.reply('**Middleman mode activated!** Use $schior.');
        await message.channel.send('**Middleman setup**\nWhat is the **Middleman role ID**? (reply with the ID number)');
        const roleId = await askQuestion(message.channel, userId, 'Middleman role ID:');
        if (roleId && !roleId.toLowerCase().includes('cancel')) {
          data.guilds[guildId].setup.middlemanRole = roleId.trim();
          saveData();
          message.reply(`**Success!** Middleman role saved: \`${roleId}\`\nYou can now use middleman commands!`);
        } else {
          message.reply('Setup cancelled.');
        }
        return;
      }
    }
    return;
  }

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  // Only middleman role can use middleman commands
  const isMiddleman = message.member.roles.cache.has(setup.middlemanRole);
  if (['schior', 'mmfee', 'confirm', 'vouch'].includes(cmd) && !isMiddleman) {
    return; // silent ignore for non-middlemen
  }

  if (cmd === 'check') {
    return message.reply('**Bot Status**\nOnline & working perfectly ✅');
  }

  if (cmd === 'help') {
    const hasTicket = hasTicketMode(userId);
    const hasMM = hasMiddlemanMode(userId);

    const embed = new EmbedBuilder()
      .setColor(0x0088ff)
      .setTitle('Bot Commands - $help')
      .setDescription('Commands you can use based on your modes.');

    embed.addFields({
      name: '🛡️ Middleman Commands' + (hasMM ? ' (unlocked)' : ''),
      value: hasMM ? 
        '` $schior ` – Recruitment embed\n' +
        '` $mmfee ` – Fee choice\n' +
        '` $confirm ` – Trade confirm\n' +
        '` $vouch @user ` – +1 vouch\n' +
        '` $vouches [@user] ` – Check vouches\n' +
        '` $afk [reason] ` – Set AFK' :
        '🔒 Redeem key → reply 2 to unlock'
    });

    embed.addFields({
      name: '🎫 Ticket Commands' + (hasTicket ? ' (unlocked)' : ''),
      value: hasTicket ? 
        '` $ticket1 ` – Post panel\n' +
        '` $claim ` – Claim ticket\n' +
        '` $unclaim ` – Unclaim\n' +
        '` $close ` – Close + transcript\n' +
        '` $add @user ` – Add user\n' +
        '` $transfer @user ` – Transfer claim' :
        '🔒 Redeem key → reply 1 to unlock'
    });

    embed.addFields({
      name: '🌐 General',
      value: 
        '` $redeem <key> ` – Redeem key\n' +
        '` $help ` – This list\n' +
        '` $vouches [@user] ` – Check vouches\n' +
        '` $afk [reason] ` – Set AFK\n' +
        '` $check ` – Bot status\n' +
        '` $mminfo ` – Middleman info\n' +
        (message.author.id === config.ownerId ? '` $dm <msg> ` – Mass DM' : '')
    });

    embed.setFooter({ text: 'Redeem keys to unlock modes' });

    return message.channel.send({ embeds: [embed] });
  }

  if (cmd === 'redeem') {
    if (!args[0]) return message.reply('Usage: $redeem <key>');
    const key = args[0];
    if (!config.validKeys[key]) return message.reply('Invalid key.');
    if (data.usedKeys.includes(key)) return message.reply('Key already used.');
    const type = config.validKeys[key];
    data.usedKeys.push(key);
    if (!data.userModes[userId]) data.userModes[userId] = { ticket: false, middleman: false };
    data.userModes[userId].redeemDate = Date.now();
    saveData();

    message.reply(`**${type} key activated!**\nReply with **1** (Ticket) or **2** (Middleman)`);

    try {
      await message.author.send(`**You redeemed a ${type} key!**\nReply 1 or 2 in the channel.`);
    } catch {}
  }

  // Mode choice (reply 1 or 2 works now)
  if (!message.content.startsWith(config.prefix) && data.userModes[userId] && (!data.userModes[userId].ticket || !data.userModes[userId].middleman)) {
    const content = message.content.trim().toLowerCase();
    if (content === '1' || content === 'ticket') {
      data.userModes[userId].ticket = true;
      saveData();
      return message.reply('**Ticket mode activated!** Use $shazam to setup.');
    }
    if (content === '2' || content === 'middleman') {
      data.userModes[userId].middleman = true;
      saveData();
      message.reply('**Middleman mode activated!** Use $schior.');
      await message.channel.send('**Middleman setup**\nWhat is the **Middleman role ID**? (reply with the ID number)');
      const roleId = await askQuestion(message.channel, userId, 'Middleman role ID:');
      if (roleId && !roleId.toLowerCase().includes('cancel')) {
        data.guilds[guildId].setup.middlemanRole = roleId.trim();
        saveData();
        message.reply(`**Success!** Middleman role saved: \`${roleId}\`\nYou can now use middleman commands!`);
      } else {
        message.reply('Setup cancelled.');
      }
      return;
    }
  }

  if (cmd === 'shazam') {
    if (!hasTicketMode(userId)) return message.reply('Ticket mode required.');
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
      ans = await askQuestion(message.channel, userId, 'Verification link (https://...):');
      if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
      if (ans.startsWith('https://')) {
        setup.verificationLink = ans;
        valid = true;
      } else {
        await message.channel.send('Must start with https://. Try again.');
      }
    }

    ans = await askQuestion(message.channel, userId, 'Guide channel ID:');
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.guideChannel = ans;

    ans = await askQuestion(message.channel, userId, 'Co-owner role ID:');
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.coOwnerRole = ans;

    saveData();
    return message.channel.send('**Setup complete!** Use $ticket1 to post panel.');
  }

  if (cmd === 'ticket1') {
    if (!hasTicketMode(userId)) return message.reply('Ticket mode required.');
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

    await message.channel.send({ embeds: [embed], components: [row] });
  }

  const ticket = data.tickets[message.channel.id];
  if (ticket) {
    const isMM = message.member.roles.cache.has(setup.middlemanRole);
    const isClaimed = message.author.id === ticket.claimedBy;
    const isCo = message.member.roles.cache.has(setup.coOwnerRole);
    const canManage = isMM || isClaimed || isCo;

    if (cmd === 'mmfee') {
      const embed = new EmbedBuilder()
        .setColor(0x00ff88)
        .setTitle('💰 Middleman Fee Guide')
        .setDescription(
          `**Small trades** (low value): **Free** ✅\n` +
          `**High-value trades**: Small fee (negotiable)\n\n` +
          `Fees reward the middleman's time & risk.\n` +
          `Accepted: Robux • Items • Crypto • Cash\n\n` +
          `**Split options**\n` +
          `• **50/50** – both pay half\n` +
          `• **100%** – one side covers full fee`
        )
        .setFooter({ text: 'Choose below • Protects both parties' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('fee_50').setLabel('50/50').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('fee_100').setLabel('100%').setStyle(ButtonStyle.Primary)
      );

      await message.channel.send({ embeds: [embed], components: [row] });
    }

    if (cmd === 'confirm') {
      const embed = new EmbedBuilder()
        .setColor(0xffff00)
        .setTitle('🔒 Final Trade Confirmation')
        .setDescription(
          `**Both parties ready to confirm?**\n\n` +
          `If everything is correct:\n` +
          `→ Click **Confirm**\n\n` +
          `If anything is wrong:\n` +
          `→ Click **Decline**\n\n` +
          `This step ensures no one gets scammed.`
        )
        .setFooter({ text: 'Confirmation is final • Protects everyone' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_yes').setLabel('Confirm').setStyle(ButtonStyle.Success).setEmoji('✅'),
        new ButtonBuilder().setCustomId('confirm_no').setLabel('Decline').setStyle(ButtonStyle.Danger).setEmoji('❌')
      );

      await message.channel.send({ embeds: [embed], components: [row] });
    }

    if (cmd === 'add') {
      if (!canManage) return message.reply('Only middlemen, claimer or co-owners can add users.');
      const target = message.mentions.users.first() || client.users.cache.get(args[0]);
      if (!target) return message.reply('Usage: $add @user or $add ID');
      if (ticket.addedUsers.includes(target.id)) return message.reply('Already added.');
      ticket.addedUsers.push(target.id);
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      return message.reply(`Added ${target}.`);
    }

    if (cmd === 'transfer') {
      if (!canManage) return message.reply('Only middlemen, claimer or co-owners can transfer.');
      const target = message.mentions.users.first() || client.users.cache.get(args[0]);
      if (!target) return message.reply('Usage: $transfer @user or ID');
      if (!message.guild.members.cache.get(target.id)?.roles.cache.has(setup.middlemanRole)) return message.reply('Target must have middleman role.');
      ticket.claimedBy = target.id;
      saveData();
      await updateTicketPerms(message.channel, ticket, setup);
      return message.reply(`Transferred to ${target}.`);
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
  }

  if (cmd === 'vouches') {
    let targetId = userId;
    if (message.mentions.users.size) targetId = message.mentions.users.first().id;
    const count = data.vouches[targetId] || 0;
    return message.reply(`**Vouches:** ${count}`);
  }

  if (cmd === 'dm') {
    if (message.author.id !== config.ownerId) return message.reply('Owner only.');
    const msg = args.join(' ');
    if (!msg) return message.reply('Usage: $dm <message>');
    let sent = 0;
    for (const uid in data.userModes) {
      try {
        const u = await client.users.fetch(uid);
        await u.send(msg);
        sent++;
      } catch {}
    }
    return message.reply(`Sent to ${sent} users`);
  }

  if (cmd === 'afk') {
    const reason = args.join(' ') || 'AFK';
    data.afk[userId] = { reason, afkSince: Date.now() };
    saveData();
    try {
      await message.member.setNickname(`[AFK] ${message.member.displayName}`);
      await message.reply(`AFK set. Reason: ${reason}`);
    } catch {
      await message.reply('AFK set (nickname failed).');
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

    if (interaction.customId === 'claim_ticket') {
      if (ticket.claimedBy) return interaction.reply({ content: 'Already claimed.', ephemeral: false });
      if (!interaction.member.roles.cache.has(setup.middlemanRole)) return interaction.reply({ content: 'Only middlemen can claim.', ephemeral: false });
      ticket.claimedBy = interaction.user.id;
      saveData();
      await updateTicketPerms(interaction.channel, ticket, setup);
      await interaction.update({
        content: `**${interaction.user} has claimed ticket**`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('unclaim_ticket').setLabel('Unclaim').setStyle(ButtonStyle.Danger)
          )
        ]
      });
    }

    if (interaction.customId === 'unclaim_ticket') {
      if (!ticket.claimedBy) return interaction.reply({ content: 'Not claimed.', ephemeral: false });
      if (ticket.claimedBy !== interaction.user.id && !interaction.member.roles.cache.has(setup.coOwnerRole)) return interaction.reply({ content: 'Only claimer or co-owner can unclaim.', ephemeral: false });
      ticket.claimedBy = null;
      saveData();
      await updateTicketPerms(interaction.channel, ticket, setup);
      await interaction.update({
        content: `**${interaction.user} has unclaimed the ticket**`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success)
          )
        ]
      });
    }

    if (interaction.customId === 'join_hitter') {
      const member = interaction.member;
      if (!member.roles.cache.has(setup.hitterRole) && setup.hitterRole) {
        await member.roles.add(setup.hitterRole);
      }
      // Send NEW public message - original embed stays
      await interaction.channel.send(
        `**${interaction.user} has been recruited!** 🔥\n` +
        `Go to #guide to learn how to hit!`
      );
    }

    if (interaction.customId === 'not_interested_hitter') {
      const member = interaction.member;
      if (member.roles.cache.has(setup.hitterRole)) {
        await interaction.channel.send(`**${interaction.user} is not interested — already a hitter.**`);
      } else {
        await member.kick('Not interested in hitter recruitment');
        await interaction.channel.send(`**${interaction.user} was kicked for not being interested.** Better luck next time.`);
      }
    }

    if (interaction.customId === 'understood_mm') {
      await interaction.channel.send(`**Got it!** You're ready to use the middleman service.`);
    }

    if (interaction.customId === 'didnt_understand_mm') {
      await interaction.channel.send(`No worries! Ask a staff member for help or read the guide channel.`);
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

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      content: `<@&${setup.middlemanRole || 'No middleman role'}> New ticket!`,
      embeds: [welcomeEmbed],
      components: [row]
    });

    await interaction.editReply(`Ticket created → ${channel}`);
  }
});

client.login(process.env.TOKEN);
