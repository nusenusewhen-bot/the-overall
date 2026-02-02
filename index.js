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
  SlashCommandBuilder,
  REST,
  Routes
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

client.once('ready', async () => {
  console.log(`Bot online → ${client.user.tag} | ${client.guilds.cache.size} servers`);

  // Register slash commands
  const commands = [
    new SlashCommandBuilder()
      .setName('redeem')
      .setDescription('Redeem a key')
      .addStringOption(option => 
        option.setName('key')
          .setDescription('The key to redeem')
          .setRequired(true)),
    new SlashCommandBuilder()
      .setName('shazam')
      .setDescription('Setup the bot (ticket mode required)')
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    console.log('Refreshing / commands...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('/ commands registered!');
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
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
        return message.reply('**Ticket mode activated!** Use /shazam to setup.');
      }
      if (content === '2' || content === 'middleman') {
        data.userModes[userId].middleman = true;
        saveData();
        message.reply('**Middleman mode activated!** Use $schior or /schior.');
        // Ask for middleman role ID
        await message.channel.send('**Middleman setup**\nWhat is the **Middleman role ID**? (reply with the ID number)');
        const roleId = await askQuestion(message.channel, userId, 'Middleman role ID:');
        if (roleId && !roleId.toLowerCase().includes('cancel')) {
          data.guilds[guildId].setup.middlemanRole = roleId.trim();
          saveData();
          message.reply(`**Success!** Middleman role saved: \`${roleId}\`\nYou can now use middleman commands like $mmfee, $confirm, $schior.`);
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

  if (cmd === 'check') {
    return message.reply('**Bot Status**\nOnline & working perfectly ✅');
  }

  if (cmd === 'mminfo') {
    const embed = new EmbedBuilder()
      .setColor(0x00aaff)
      .setTitle('🔰 Middleman Service Info')
      .setDescription(
        `**Welcome to the Middleman Service**\n\n` +
        `We provide **100% safe trades** between two parties.\n` +
        `Middleman holds items/money until both sides confirm.\n\n` +
        `**Key Rules**\n` +
        `• No scams – instant ban & blacklist\n` +
        `• Fees only on high-value trades (negotiable)\n` +
        `• Respect everyone & follow Discord TOS\n` +
        `• Use $mmfee and $confirm in tickets\n\n` +
        `**Recruitment**\nUse $schior to join as hitter!\n\n` +
        `Safe • Fast • Trusted`
      )
      .setImage('https://i.postimg.cc/your-image-34-link-here.png') // ← REPLACE WITH YOUR IMAGE URL (upload image-34.png to Imgur/Discord/etc.)
      .setFooter({ text: 'Middleman Service • Secure Trades Only' })
      .setTimestamp();

    await message.channel.send({ embeds: [embed] });
  }

  // Redeem (legacy prefix)
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
      await message.author.send(`**You redeemed a ${type} key!**\nReply 1 or 2 in channel.`);
    } catch {}
  }

  // Mode choice
  if (!message.content.startsWith(config.prefix) && data.userModes[userId] && (!data.userModes[userId].ticket || !data.userModes[userId].middleman)) {
    const content = message.content.trim().toLowerCase();
    if (content === '1' || content === 'ticket') {
      data.userModes[userId].ticket = true;
      saveData();
      return message.reply('**Ticket mode activated!** Use /shazam to setup.');
    }
    if (content === '2' || content === 'middleman') {
      data.userModes[userId].middleman = true;
      saveData();
      message.reply('**Middleman mode activated!** Use $schior or /schior.');
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

  // Restrict middleman commands
  if (['schior', 'mmfee', 'confirm', 'vouch'].includes(cmd) && !hasMiddlemanMode(userId)) {
    return; // silent ignore
  }

  // Middleman commands (now work anywhere)
  if (cmd === 'schior') {
    if (!hasMiddlemanMode(userId)) return;

    const embed = new EmbedBuilder()
      .setColor(0x2f3136)
      .setTitle('🌟 Join the Hitter Squad?')
      .setDescription(
        `Got scammed? Turn the tables 😈\n\n` +
        `**How it works**\n` +
        `1. Find a victim in trading servers (ADM, MM2, PSX, etc.)\n` +
        `2. Get them to use our middleman service\n` +
        `3. Middleman helps secure the item (crypto/robux/items)\n` +
        `4. You split **50/50** with the middleman\n\n` +
        `Full guide in the guide channel!`
      )
      .addFields({
        name: '🚨 STAFF ALERT',
        value: 'Ready to join? Click below!'
      })
      .setFooter({ text: '1 hour to respond • Join or get kicked!' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('join_hitter').setLabel('Join Us').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('not_interested_hitter').setLabel('Not Interested').setStyle(ButtonStyle.Danger)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
  }

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

  if (cmd === 'vouches') {
    let targetId = userId;
    if (message.mentions.users.size) targetId = message.mentions.users.first().id;
    const count = data.vouches[targetId] || 0;
    return message.reply(`**Vouches:** ${count}`);
  }

  if (cmd === 'mminfo') {
    const embed = new EmbedBuilder()
      .setColor(0x00aaff)
      .setTitle('🔰 Middleman Service Overview')
      .setDescription(
        `**Welcome to the Middleman Service**\n\n` +
        `We provide **100% safe & trusted trades**.\n` +
        `Middleman holds items/money until both sides confirm.\n\n` +
        `**Core Rules**\n` +
        `• No scams – instant ban & blacklist\n` +
        `• Fees only on high-value trades (negotiable)\n` +
        `• Respect all users & Discord TOS\n` +
        `• Use $mmfee & $confirm in tickets\n\n` +
        `**Recruitment**\nUse $schior to join as hitter!\n\n` +
        `Safe • Fast • Trusted`
      )
      .setImage('https://i.postimg.cc/your-image-34-link.png') // ← REPLACE WITH ACTUAL IMAGE URL
      .setFooter({ text: 'Middleman Service • Secure Trades Only' })
      .setTimestamp();

    await message.channel.send({ embeds: [embed] });
  }
});

client.on('interactionCreate', async interaction => {
  // Slash commands
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'redeem') {
      const key = interaction.options.getString('key');
      if (!config.validKeys[key]) return interaction.reply({ content: 'Invalid key.', ephemeral: true });
      if (data.usedKeys.includes(key)) return interaction.reply({ content: 'Key already used.', ephemeral: true });

      const type = config.validKeys[key];
      data.usedKeys.push(key);
      if (!data.userModes[interaction.user.id]) data.userModes[interaction.user.id] = { ticket: false, middleman: false };
      saveData();

      await interaction.reply({
        content: `**${type} key activated!**\nReply with **1** (Ticket) or **2** (Middleman)`,
        ephemeral: false
      });
    }

    if (interaction.commandName === 'shazam') {
      if (!hasTicketMode(interaction.user.id)) return interaction.reply({ content: 'Ticket mode required.', ephemeral: true });
      await interaction.reply('Setup started. Answer questions in this channel. Type "cancel" to stop.');

      // Add shazam logic here (same as prefix version)
      // ...
    }
  }

  // Button interactions (claim/unclaim toggle, join/not interested)
  // ... (keep from previous version)
});

client.login(process.env.TOKEN);
