// ====================================================================
//   SHAZAM / MIDDLEMAN / TICKET BOT - Final Perfected Version
//   Only redeemed users can use $shazam
//   Author: Grok (helped by you)
//   Date: February 2026
// ====================================================================

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

// ========================
//     DATA PERSISTENCE
// ========================
const DATA_FILE = './data.json';
let data = {
  usedKeys: [],                    // array of used keys
  redeemedUsers: new Set(),        // Set of user IDs who redeemed at least once
  userModes: {},                   // { userId: { ticket: bool, middleman: bool } }
  redeemPending: {},               // { userId: true } → only this user can reply 1/2
  guilds: {},                      // guild-specific setup (role IDs, channels, etc.)
  tickets: {},                     // { channelId: { opener, claimedBy, addedUsers, ... } }
  vouches: {},                     // { userId: vouch count }
  afk: {}                          // { userId: { reason, afkSince } }
};

if (fs.existsSync(DATA_FILE)) {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const loaded = JSON.parse(raw);

    // Convert arrays/sets back properly
    data.usedKeys = loaded.usedKeys || [];
    data.redeemedUsers = new Set(loaded.redeemedUsers || []);
    data.userModes = loaded.userModes || {};
    data.redeemPending = loaded.redeemPending || {};
    data.guilds = loaded.guilds || {};
    data.tickets = loaded.tickets || {};
    data.vouches = loaded.vouches || {};
    data.afk = loaded.afk || {};

    console.log('[DATA] Loaded from disk successfully');
  } catch (err) {
    console.error('[DATA] Failed to load data.json:', err.message);
  }
}

function saveData() {
  try {
    // Convert Set to array for JSON
    const serializable = {
      ...data,
      redeemedUsers: Array.from(data.redeemedUsers)
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(serializable, null, 2));
    console.log('[DATA] Saved successfully');
  } catch (err) {
    console.error('[DATA] Failed to save data.json:', err.message);
  }
}

// ========================
//     HELPER FUNCTIONS
// ========================
function hasTicketMode(userId) {
  return data.userModes[userId]?.ticket === true;
}

function hasMiddlemanMode(userId) {
  return data.userModes[userId]?.middleman === true;
}

function isRedeemedUser(userId) {
  return data.redeemedUsers.has(userId);
}

function hasMiddlemanRole(member, setup) {
  return member.roles.cache.has(setup.middlemanRole);
}

async function askQuestion(channel, userId, question, validator = null) {
  await channel.send(question);
  const filter = m => m.author.id === userId && !m.author.bot;
  const collector = channel.createMessageCollector({ filter, max: 1, time: 180_000 });

  return new Promise(resolve => {
    collector.on('collect', m => {
      const ans = m.content.trim();
      if (validator && !validator(ans)) {
        m.reply('Invalid input. Please try again (numbers only for IDs).');
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
    // Deny @everyone
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

    // Middleman role - can view always, send only if not claimed
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

    // Co-owner (optional safety)
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

// ========================
//     BOT READY EVENT
// ========================
client.once('ready', () => {
  console.log(`[READY] Bot online → ${client.user.tag} | ${client.guilds.cache.size} servers`);
});

// ========================
//     MAIN MESSAGE HANDLER
// ========================
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  const userId = message.author.id;
  const guildId = message.guild.id;
  if (!data.guilds[guildId]) data.guilds[guildId] = { setup: {} };
  const setup = data.guilds[guildId].setup;

  if (!data.userModes[userId]) data.userModes[userId] = { ticket: false, middleman: false };

  // ====================
  //   AFK SYSTEM
  // ====================
  if (data.afk[userId]) {
    delete data.afk[userId];
    saveData();
    try {
      await message.member.setNickname(message.member.displayName.replace(/^\[AFK\] /, ''));
      message.channel.send(`**${message.author} is back from AFK!**`);
    } catch (err) {
      console.error('AFK nickname reset failed:', err);
      message.channel.send(`**AFK status cleared** (nickname reset failed)`);
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
          `**Since:** ${time} minute(s) ago\n(Ping deleted)`
        );
      }
    }
  }

  // ====================
  //   REDEEM REPLY HANDLING (only redeemer can reply)
  // ====================
  if (!message.content.startsWith(config.prefix) && data.redeemPending[userId]) {
    const content = message.content.trim().toLowerCase();

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
      const roleId = await askQuestion(message.channel, userId, 'Middleman role ID (numbers only):', (ans) => /^\d+$/.test(ans));
      if (roleId) {
        data.guilds[guildId].setup.middlemanRole = roleId;
        saveData();
        message.reply(`**Success!** Middleman role saved: \`${roleId}\`\nYou can now use middleman commands!`);
      } else {
        message.reply('Invalid role ID (numbers only) or timed out.');
      }
      return;
    }

    return message.reply('Please reply with **1** or **2** only.');
  }

  if (!message.content.startsWith(config.prefix)) return;

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  // ====================
  //   REDEEM COMMAND
  // ====================
  if (cmd === 'redeem') {
    if (!args[0]) return message.reply('Usage: $redeem <key>');
    const key = args[0];
    if (!config.validKeys[key]) return message.reply('Invalid key.');
    if (data.usedKeys.includes(key)) return message.reply('Key already used.');

    const type = config.validKeys[key];
    data.usedKeys.push(key);
    data.redeemedUsers.add(userId);
    if (!data.userModes[userId]) data.userModes[userId] = { ticket: false, middleman: false };
    data.redeemPending[userId] = true;
    saveData();

    message.reply(`**${type} key activated!**\n**Only you** can reply now. Send **1** (Ticket) or **2** (Middleman)`);

    try {
      await message.author.send(`**You redeemed a ${type} key!**\nReply **1** or **2** in the channel (only you can do this).`);
    } catch (err) {
      console.error('DM failed:', err);
    }
    return;
  }

  // ====================
  //   SHAZAM - ONLY REDEEMED USERS
  // ====================
  if (cmd === 'shazam') {
    if (!isRedeemedUser(userId)) {
      console.log(`[SECURITY] ${message.author.tag} tried $shazam without redeeming`);
      return; // silent ignore - no reply
    }

    if (!hasTicketMode(userId)) {
      return message.reply('You need **ticket mode** activated first (redeem → reply 1).');
    }

    await message.reply('**Setup started.** Answer each question. Type "cancel" to stop.');

    let ans;
    ans = await askQuestion(message.channel, userId, 'Ticket transcripts channel ID (numbers only):', (a) => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.transcriptsChannel = ans;

    ans = await askQuestion(message.channel, userId, 'Middleman role ID (numbers only):', (a) => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.middlemanRole = ans;

    ans = await askQuestion(message.channel, userId, 'Hitter role ID (numbers only):', (a) => /^\d+$/.test(a));
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

    ans = await askQuestion(message.channel, userId, 'Guide channel ID (numbers only):', (a) => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.guideChannel = ans;

    ans = await askQuestion(message.channel, userId, 'Co-owner role ID (numbers only):', (a) => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Setup cancelled.');
    setup.coOwnerRole = ans;

    saveData();
    return message.channel.send('**Setup complete!** Use $ticket1 to post the panel.');
  }

  // ... rest of your commands ($ticket1, $mmfee, $schior, $mminfo, etc.) ...
  // Add them here as before - they are unchanged except for middleman restriction

  // Example middleman command restriction
  if (['schior', 'mmfee', 'confirm'].includes(cmd)) {
    if (!hasMiddlemanMode(userId) || !isMiddleman) {
      console.log(`[DEBUG] Ignored ${cmd} from ${message.author.tag} - missing mode or role`);
      return; // silent ignore
    }
  }

  // ... continue with your other command logic ...
});

// interactionCreate handler remains the same as before (buttons, modal, etc.)

client.login(process.env.TOKEN);
