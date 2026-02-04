// Discord Middleman + Ticket Bot
const { 
  Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const fs = require('fs');

let config;
try { config = require('./config.json'); } catch { 
  config = { prefix: '$', validKeys: { 'KEY-123': 'Premium', 'KEY-456': 'Basic' } }; 
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers
  ]
});

const BOT_OWNER_ID = process.env.BOT_OWNER_ID || 'YOUR_OWNER_ID_HERE';
const DATA_FILE = './data.json';

let data = { 
  usedKeys: [], redeemedUsers: new Set(), userModes: {}, redeemPending: {}, 
  guilds: {}, tickets: {}, vouches: {}, afk: {} 
};

// Load data
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
    console.log('[DATA] Loaded');
  } catch (err) { console.error('[DATA] Load failed:', err); }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ ...data, redeemedUsers: Array.from(data.redeemedUsers) }, null, 2));
  } catch (err) { console.error('[DATA] Save failed:', err); }
}

function hasTicketMode(uid) { return data.userModes[uid]?.ticket === true; }
function hasMiddlemanMode(uid) { return data.userModes[uid]?.middleman === true; }
function isRedeemed(uid) { return data.redeemedUsers.has(uid); }

async function ask(channel, userId, question, validator) {
  await channel.send(question);
  const filter = m => m.author.id === userId && !m.author.bot;
  return new Promise(resolve => {
    const collector = channel.createMessageCollector({ filter, max: 1, time: 180000 });
    collector.on('collect', m => {
      const ans = m.content.trim();
      if (validator && !validator(ans)) { m.reply('Invalid input'); collector.resetTimer(); return; }
      resolve(ans);
    });
    collector.on('end', (c, r) => { if (r === 'time') { channel.send('Timed out'); resolve(null); } });
  });
}

async function updateTicketPerms(channel, ticket, setup) {
  try {
    const overwrites = [
      { id: channel.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: ticket.opener, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }
    ];

    if (setup.coOwnerRole) overwrites.push({ id: setup.coOwnerRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
    if (setup.middlemanRole && !ticket.isSellerTicket && !ticket.isShopTicket) overwrites.push({ id: setup.middlemanRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: ticket.claimedBy ? [] : [PermissionsBitField.Flags.SendMessages] });
    if (setup.indexMiddlemanRole && !ticket.isSellerTicket && !ticket.isShopTicket) overwrites.push({ id: setup.indexMiddlemanRole, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory], deny: ticket.claimedBy ? [] : [PermissionsBitField.Flags.SendMessages] });
    if (ticket.claimedBy) overwrites.push({ id: ticket.claimedBy, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });

    ticket.addedUsers.forEach(uid => overwrites.push({ id: uid, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }));

    await channel.permissionOverwrites.set(overwrites);
  } catch (err) { console.error('Perms error:', err); }
}

client.once('ready', () => console.log(`[READY] ${client.user.tag} online`));

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;
  const uid = message.author.id;
  const gid = message.guild.id;
  if (!data.guilds[gid]) data.guilds[gid] = { setup: {} };
  const setup = data.guilds[gid].setup;
  if (!data.userModes[uid]) data.userModes[uid] = { ticket: false };

  // AFK ping reply
  if (message.mentions.users.size) {
    message.mentions.users.forEach(u => {
      if (data.afk[u.id]) message.channel.send(`${u.tag} is AFK: ${data.afk[u.id]}`);
    });
  }

  // Redeem pending reply
  if (!message.content.startsWith(config.prefix) && data.redeemPending[uid]) {
    const c = message.content.trim().toLowerCase();
    if (c === '1' || c === 'ticket') { data.userModes[uid].ticket = true; delete data.redeemPending[uid]; saveData(); return message.reply('**Ticket mode activated!** Use $shazam.'); }
    if (c === '2' || c === 'middleman') { data.userModes[uid].middleman = true; delete data.redeemPending[uid]; saveData(); return message.reply('**Middleman mode activated!** Use $shazam1.'); }
    return message.reply('Reply **1** or **2** only.');
  }

  if (!message.content.startsWith(config.prefix)) return;
  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  // Redeem
  if (cmd === 'redeem') {
    const key = args[0];
    if (!key || !config.validKeys[key]) return message.reply('Invalid key.');
    if (data.usedKeys.includes(key)) return message.reply('Key already used.');
    data.usedKeys.push(key); data.redeemedUsers.add(uid); data.redeemPending[uid] = true; saveData();
    return message.reply('**Key activated!** Reply **1** (Ticket) or **2** (Middleman).');
  }

  // Middleman commands
  if (['schior','mmfee','mminfo','vouches','vouch','setvouches'].includes(cmd)) {
    const mm = setup.middlemanRole, imm = setup.indexMiddlemanRole;
    if (!mm && !imm) return message.reply('No middleman roles configured. Run $shazam1.');
    const hasMM = mm && message.member.roles.cache.has(mm), hasIMM = imm && message.member.roles.cache.has(imm);
    if (!hasMM && !hasIMM) return message.reply('You need the middleman role.');
    if (cmd === 'vouches') { const target = message.mentions.users.first() || client.users.cache.get(args[0]) || message.author; return message.reply(`${target} has **${data.vouches[target.id]||0}** vouches.`); }
    if (cmd === 'vouch') { const target = message.mentions.users.first()||client.users.cache.get(args[0]); if(!target||target.id===uid)return message.reply('Invalid'); data.vouches[target.id]=(data.vouches[target.id]||0)+1; saveData(); return message.reply(`Vouched for ${target.tag}`); }
    if (cmd === 'setvouches') { if(uid!==BOT_OWNER_ID)return; const t=message.mentions.users.first()||client.users.cache.get(args[0]); const n=parseInt(args[1]); if(!t||isNaN(n))return; data.vouches[t.id]=n; saveData(); return message.reply(`Set vouches to ${n}`); }
    if (cmd==='mmfee') return message.reply('Fee info here'); 
    if (cmd==='mminfo') return message.reply('Middleman info here'); 
    if (cmd==='schior') return message.reply('Schior online'); 
  }

  // Setup commands
  if (cmd==='shazam') {
    if(!isRedeemed(uid)) return message.reply('Redeem first');
    const transcripts=await ask(message.channel,uid,'Transcript Channel ID'); if(!transcripts)return;
    setup.transcriptsChannel=transcripts;
    setup.middlemanRole=await ask(message.channel,uid,'Middleman Role ID'); 
    setup.indexMiddlemanRole=await ask(message.channel,uid,'Index Middleman Role ID');
    setup.coOwnerRole=await ask(message.channel,uid,'Co-Owner Role ID');
    setup.ticketCategory=await ask(message.channel,uid,'Ticket Category ID'); saveData();
    return message.reply('Setup complete');
  }
  if (cmd==='shazam1') {
    if(!isRedeemed(uid)) return message.reply('Redeem first');
    setup.middlemanRole=await ask(message.channel,uid,'Middleman Role ID');
    setup.indexMiddlemanRole=await ask(message.channel,uid,'Index Middleman Role ID');
    setup.coOwnerRole=await ask(message.channel,uid,'Co-Owner Role ID');
    setup.guideChannel=await ask(message.channel,uid,'Guide Channel ID'); saveData();
    return message.reply('Middleman setup complete');
  }

  // Ticket panels
  if (['ticket1','index','seller','shop'].includes(cmd)) {
    if(!isRedeemed(uid)) return message.reply('Redeem first');
    const embed=new EmbedBuilder().setTitle('Support Ticket').setDescription('Click below to open a ticket.');
    const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`request_${cmd==='ticket1'?'ticket':cmd}`).setLabel('Open Ticket').setStyle(ButtonStyle.Primary));
    return message.channel.send({embeds:[embed],components:[row]});
  }

  // AFK
  if(cmd==='afk'){ const reason=args.join(' ')||'AFK'; data.afk[uid]=reason; saveData(); return message.reply(`You are now AFK: ${reason}`); }

  // Owner DM
  if(cmd==='dm' && args[0]==='all' && uid===BOT_OWNER_ID){ const msg=args.slice(1).join(' '); client.guilds.cache.forEach(g=>g.members.cache.forEach(m=>m.send(msg).catch(()=>{}))); return; }

  // Inside tickets
  const ticket=data.tickets[message.channel.id];
  if(ticket){
    if(cmd==='claim'){ if(ticket.claimedBy)return; ticket.claimedBy=uid; saveData(); await updateTicketPerms(message.channel,ticket,setup); return message.reply('Claimed'); }
    if(cmd==='unclaim'){ if(ticket.claimedBy!==uid)return; ticket.claimedBy=null; saveData(); await updateTicketPerms(message.channel,ticket,setup); return message.reply('Unclaimed'); }
    if(cmd==='close'){ if(setup.transcriptsChannel){ const msgs=await message.channel.messages.fetch({limit:100}); const transcript=msgs.reverse().map(m=>`[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content||'[Media]'}`).join('\n'); const chan=message.guild.channels.cache.get(setup.transcriptsChannel); if(chan) await chan.send({files:[{attachment:Buffer.from(transcript,'utf-8'),name:`${message.channel.name}-transcript.txt`}]}); } return message.channel.delete(); }
  }
});

// Interaction Create (Buttons + Modals)
client.on('interactionCreate', async interaction=>{
  if(!interaction.isButton()&&!interaction.isModalSubmit())return;
  const setup=data.guilds[interaction.guild.id]?.setup||{};
  if(interaction.isButton()&&interaction.customId.startsWith('request_')){
    const modal=new ModalBuilder().setCustomId(`${interaction.customId.replace('request_','')}_modal`).setTitle('Ticket Form');
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('desc').setLabel('Details').setStyle(TextInputStyle.Paragraph).setRequired(true)));
    return interaction.showModal(modal);
  }

  if(interaction.isModalSubmit()){
    const type=interaction.customId.replace('_modal','');
    const channel=await interaction.guild.channels.create({
      name:`${type}-${interaction.user.username.toLowerCase()}`,
      type:ChannelType.GuildText,
      parent:setup.ticketCategory
    });
    data.tickets[channel.id]={opener:interaction.user.id,claimedBy:null,addedUsers:[],isIndexTicket:type==='index',isSellerTicket:type==='seller',isShopTicket:type==='shop'};
    saveData();
    await updateTicketPerms(channel,data.tickets[channel.id],setup);

    const row=new ActionRowBuilder()
      .addComponents(new ButtonBuilder().setCustomId(type==='index'?'claim_index_ticket':'claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success))
      .addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Secondary));

    await channel.send({content:'Welcome to your ticket!',components:[row]});
    return interaction.reply({content:`Created: ${channel}`,ephemeral:true});
  }

  if(interaction.isButton()){
    const ticket=data.tickets[interaction.channel.id];
    if(!ticket)return;
    if(interaction.customId==='close_ticket'){ if(setup.transcriptsChannel){ const msgs=await interaction.channel.messages.fetch({limit:100}); const transcript=msgs.reverse().map(m=>`[${m.createdAt.toLocaleString()}] ${m.author.tag}: ${m.content||'[Media]'}`).join('\n'); const chan=interaction.guild.channels.cache.get(setup.transcriptsChannel); if(chan) await chan.send({files:[{attachment:Buffer.from(transcript,'utf-8'),name:`${interaction.channel.name}-transcript.txt`} ]}); } return interaction.channel.delete(); }
    if(interaction.customId.startsWith('claim')){ if(ticket.claimedBy)return interaction.reply({content:'Claimed',ephemeral:true}); ticket.claimedBy=interaction.user.id; saveData(); await updateTicketPerms(interaction.channel,ticket,setup); const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('unclaim_ticket').setLabel('Unclaim').setStyle(ButtonStyle.Danger)).addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Secondary)); return interaction.update({content:`Claimed by ${interaction.user}`,components:[row]}); }
    if(interaction.customId==='unclaim_ticket'){ ticket.claimedBy=null; saveData(); await updateTicketPerms(interaction.channel,ticket,setup); const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(ticket.isIndexTicket?'claim_index_ticket':'claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success)).addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Secondary)); return interaction.update({content:'Unclaimed',components:[row]}); }
  }
});

client.login(process.env.DISCORD_TOKEN);
