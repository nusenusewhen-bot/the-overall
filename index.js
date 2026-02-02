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
  redeemPending: {}, // { userId: true } → only this user can reply to redeem
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
    // Deny everyone by default
    await channel.permissionOverwrites.edit(channel.guild.id, {
      ViewChannel: false,
      SendMessages: false
    });

    // Allow opener
    await channel.permissionOverwrites.edit(ticket.opener, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    });

    // Middleman role - can see always, type only if not claimed
    if (setup.middlemanRole) {
      await channel.permissionOverwrites.edit(setup.middlemanRole, {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: ticket.claimedBy ? false : true
      });
    }

    // Claimed user
    if (ticket.claimedBy) {
      await channel.permissionOverwrites.edit(ticket.claimedBy, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      });
    }

    // Added users
    ticket.addedUsers.forEach(uid => {
      channel.permissionOverwrites.edit(uid, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      }).catch(() => {});
    });

    // Co-owner (optional)
    if (setup.coOwnerRole) {
      await channel.permissionOverwrites.edit(setup.coOwnerRole, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      });
    }
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
      message.channel.send(`**AFK status removed** (nickname reset failed - bot needs Manage Nicknames permission)`);
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

  // Redeem reply protection + number-only validation
  if (!message.content.startsWith(config.prefix) && data.redeemPending[userId]) {
    const content = message.content.trim();
    if (content === '1' || content === 'ticket') {
      data.userModes[userId].ticket = true;
      delete data.redeemPending[userId];
      saveData();
      return message.reply('**Ticket mode activated!** Use $shazam to setup.');
    }
    if (content === '2' || content === 'middleman') {
      data.userModes[userId].middleman = true;
      delete data.redeemPending[userId];
      saveData();
      message.reply('**Middleman mode activated!** Use $schior.');
      await message.channel.send('**Middleman setup**\nReply with the **Middleman role ID** (numbers only)');
      const roleId = await askQuestion(message.channel, userId, 'Middleman role ID (numbers only):');
      if (roleId && /^\d+$/.test(roleId) && !roleId.toLowerCase().includes('cancel')) {
        data.guilds[guildId].setup.middlemanRole = roleId.trim();
        saveData();
        message.reply(`**Success!** Middleman role saved: \`${roleId}\`\nYou can now use middleman commands!`);
      } else {
        message.reply('Invalid role ID (numbers only) or cancelled.');
      }
      return;
    }
    return; // ignore other replies during pending
  }

  if (!message.content.startsWith(config.prefix)) return;

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  // Redeem - mark user as pending
  if (cmd === 'redeem') {
    if (!args[0]) return message.reply('Usage: $redeem <key>');
    const key = args[0];
    if (!config.validKeys[key]) return message.reply('Invalid key.');
    if (data.usedKeys.includes(key)) return message.reply('Key already used.');
    const type = config.validKeys[key];
    data.usedKeys.push(key);
    if (!data.userModes[userId]) data.userModes[userId] = { ticket: false, middleman: false };
    data.userModes[userId].redeemDate = Date.now();
    data.redeemPending[userId] = true; // only this user can reply now
    saveData();

    message.reply(`**${type} key activated!**\n**Only you** can reply now. Send **1** (Ticket) or **2** (Middleman)`);

    try {
      await message.author.send(`**You redeemed a ${type} key!**\nReply **1** or **2** in the channel (only you can do this).`);
    } catch {}
    return;
  }

  // Middleman commands - only if user has middleman role
  const isMiddleman = message.member.roles.cache.has(setup.middlemanRole);
  if (['schior', 'mmfee', 'confirm', 'vouch'].includes(cmd)) {
    if (!isMiddleman) {
      console.log(`[DEBUG] Ignored ${cmd} from ${message.author.tag} - missing middleman role`);
      return; // silent ignore
    }
  }

  // Other commands...
  if (cmd === 'schior') {
    const embed = new EmbedBuilder()
      .setColor(0x000000)
      .setTitle('Want to join us?')
      .setDescription(
        `You just got scammed! Wanna be a hitter like us? 😈\n\n` +
        `1. You find victim in trading server (for eg: ADM, MM2, PSX ETC.)\n` +
        `2. You get the victim to use our middleman service's\n` +
        `3. Then the middleman will help you scam the item CRYPTPO/ROBUX/INGAME ETC.\n` +
        `4. Once done the middleman and you split the item 50/50\n\n` +
        `Be sure to check the guide channel for everything you need to know.\n\n` +
        `**STAFF IMPORTANT**\n` +
        `If you're ready, click the button below to start and join the team!\n\n` +
        `🕒 You have 1 hour to click 'Join Us' or you will be kicked!`
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('join_hitter').setLabel('Join Us').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('not_interested_hitter').setLabel('Not Interested').setStyle(ButtonStyle.Danger)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
  }

  // ... rest of your commands (mminfo, ticket1, etc.) stay the same ...
});

// interactionCreate with updated button logic
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return;

  const setup = data.guilds[interaction.guild.id]?.setup || {};
  const ticket = data.tickets[interaction.channel?.id];

  if (interaction.isButton()) {
    // ... other buttons (claim, unclaim, request_ticket) stay the same ...

    if (interaction.customId === 'join_hitter') {
      const member = interaction.member;
      if (!member.roles.cache.has(setup.hitterRole) && setup.hitterRole) {
        await member.roles.add(setup.hitterRole);
      }
      await interaction.channel.send(
        `**${interaction.user} has been recruited!** 🔥\n` +
        `Go to #guide to learn how to hit!`
      );
    }

    if (interaction.customId === 'not_interested_hitter') {
      await interaction.channel.send(
        `**${interaction.user} was not interested**, we will be kicking you in 1 hour.\n` +
        `If you change your mind, click **Join Us**!`
      );
      // Optional future kick (uncomment if you want auto-kick after 1 hour)
      // setTimeout(() => {
      //   interaction.member.kick('Did not respond to recruitment in time');
      // }, 3600000);
    }

    if (interaction.customId === 'understood_mm') {
      await interaction.channel.send(`**${interaction.user} Got it!** You're ready to use the middleman service.`);
    }

    if (interaction.customId === 'didnt_understand_mm') {
      await interaction.channel.send(`**${interaction.user}** No worries! Ask a staff member for help or read the guide channel.`);
    }
  }

  // modal handling stays the same...
});

client.login(process.env.TOKEN);
