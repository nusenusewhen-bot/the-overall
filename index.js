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
    console.log('[DATA] Loaded successfully');
  } catch (err) {
    console.error('[DATA] Load failed:', err.message);
  }
}

function saveData() {
  try {
    const serializable = {
      ...data,
      redeemedUsers: Array.from(data.redeemedUsers)
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(serializable, null, 2));
  } catch (err) {
    console.error('[DATA] Save failed:', err.message);
  }
}

function hasTicketMode(userId) { return data.userModes[userId]?.ticket === true; }
function hasMiddlemanMode(userId) { return data.userModes[userId]?.middleman === true; }
function isRedeemedUser(userId) { return data.redeemedUsers.has(userId); }

async function askQuestion(channel, userId, question, validator = null) {
  await channel.send(question);
  const filter = m => m.author.id === userId && !m.author.bot;
  const collector = channel.createMessageCollector({ filter, max: 1, time: 180000 });
  return new Promise(resolve => {
    collector.on('collect', m => {
      const ans = m.content.trim();
      if (validator && !validator(ans)) {
        m.reply('Invalid — numbers only for IDs.');
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

    await channel.permissionOverwrites.edit(ticket.opener, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });

    if (setup.middlemanRole) {
      await channel.permissionOverwrites.edit(setup.middlemanRole, {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: ticket.claimedBy ? false : true
      });
    }

    if (ticket.claimedBy) {
      await channel.permissionOverwrites.edit(ticket.claimedBy, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    }

    ticket.addedUsers.forEach(uid => {
      channel.permissionOverwrites.edit(uid, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
    });

    if (setup.coOwnerRole) {
      await channel.permissionOverwrites.edit(setup.coOwnerRole, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    }
  } catch (err) {
    console.error('Perms error:', err);
  }
}

client.once('ready', () => {
  console.log(`[READY] ${client.user.tag} online in ${client.guilds.cache.size} servers`);
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  const userId = message.author.id;
  const guildId = message.guild.id;
  if (!data.guilds[guildId]) data.guilds[guildId] = { setup: {} };
  const setup = data.guilds[guildId].setup;

  if (!data.userModes[userId]) data.userModes[userId] = { ticket: false, middleman: false };

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

  // Redeem reply - only redeemer
  if (!message.content.startsWith(config.prefix) && data.redeemPending[userId]) {
    const content = message.content.trim().toLowerCase();
    if (content === '1' || content === 'ticket') {
      data.userModes[userId].ticket = true;
      delete data.redeemPending[userId];
      saveData();
      return message.reply('**Ticket mode on!** Use $shazam.');
    }
    if (content === '2' || content === 'middleman') {
      data.userModes[userId].middleman = true;
      delete data.redeemPending[userId];
      saveData();
      message.reply('**Middleman mode on!** Use $schior.');

      // New question: Hitter role ID
      await message.channel.send('**Hitter role ID** (numbers only):');
      const hitterId = await askQuestion(message.channel, userId, 'Hitter role ID (numbers only):', ans => /^\d+$/.test(ans));
      if (hitterId) {
        data.guilds[guildId].setup.hitterRole = hitterId;
        saveData();
        message.reply(`Hitter role saved: \`${hitterId}\``);
      } else {
        message.reply('Cancelled or invalid (numbers only).');
      }

      // New question: Welcome channel ID
      await message.channel.send('**Welcome hitter channel ID** (numbers only):');
      const welcomeId = await askQuestion(message.channel, userId, 'Welcome channel ID (numbers only):', ans => /^\d+$/.test(ans));
      if (welcomeId) {
        data.guilds[guildId].setup.welcomeHitterChannel = welcomeId;
        saveData();
        message.reply(`Welcome channel saved: \`${welcomeId}\``);
      } else {
        message.reply('Cancelled or invalid (numbers only).');
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
    if (data.usedKeys.includes(key)) return message.reply('Used.');

    const type = config.validKeys[key];
    data.usedKeys.push(key);
    data.redeemedUsers.add(userId);
    data.redeemPending[userId] = true;
    saveData();

    message.reply(`**${type} key activated!**\n**Only you** can reply now. Send **1** (Ticket) or **2** (Middleman)`);
    try { await message.author.send(`Redeemed ${type}! Reply 1 or 2 in channel.`); } catch {}
    return;
  }

  // Shazam - only redeemed users
  if (cmd === 'shazam') {
    if (!data.redeemedUsers.has(userId)) return; // silent ignore
    if (!hasTicketMode(userId)) return message.reply('Ticket mode required (redeem → reply 1).');

    await message.reply('**Setup started.** Answer questions. "cancel" to stop.');

    let ans;
    ans = await askQuestion(message.channel, userId, 'Transcripts channel ID (numbers):', a => /^\d+$/.test(a));
    if (!ans || ans.toLowerCase() === 'cancel') return message.reply('Cancelled.');
    setup.transcriptsChannel = ans;

    // ... rest of shazam questions (same as before) ...

    saveData();
    message.channel.send('**Setup done!** Use $ticket1.');
  }

  // Schior
  if (cmd === 'schior') {
    if (!hasMiddlemanMode(userId) || !hasMiddlemanRole(message.member, setup)) return;

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

  // ... other commands ($ticket1, $mmfee, $mminfo, etc.) go here ...
});

// interactionCreate with updated buttons
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const setup = data.guilds[interaction.guild.id]?.setup || {};

  if (interaction.customId === 'join_hitter') {
    const member = interaction.member;
    if (!member.roles.cache.has(setup.hitterRole) && setup.hitterRole) {
      await member.roles.add(setup.hitterRole);
    }

    // Send to welcome channel
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
    } else {
      console.log('[WARN] Welcome hitter channel not found:', setup.welcomeHitterChannel);
    }

    await interaction.reply({ content: `You joined! Check <#${setup.welcomeHitterChannel}>`, ephemeral: true });
  }

  if (interaction.customId === 'not_interested_hitter') {
    await interaction.channel.send(
      `**${interaction.user} was not interested**, we will be kicking you in 1 hour.\n` +
      `If you change your mind, click **Join Us**!`
    );
  }

  // ... other buttons (claim, mminfo understood, etc.) ...
});

client.login(process.env.TOKEN);
