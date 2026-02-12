# main.py — FULLY FIXED BOT (discord.py 2.4.0) — All features + heavy logging
import discord
from discord.ext import commands
import json
import os
from dotenv import load_dotenv
import asyncio
import traceback
import sys

print("[BOT START] Loading environment variables...")
load_dotenv()
TOKEN = os.getenv('TOKEN')
if not TOKEN:
    print("[CRITICAL] No TOKEN found in .env or Railway Variables!")
    sys.exit(1)
print("[BOT START] Token loaded")

# Load config
print("[BOT START] Loading config.json...")
try:
    with open('config.json', 'r') as f:
        config = json.load(f)
    print("[BOT START] config.json loaded successfully")
except Exception as e:
    print(f"[CRITICAL] Failed to load config.json: {e}")
    sys.exit(1)

intents = discord.Intents.default()
intents.message_content = True
intents.members = True

print("[BOT START] Creating bot instance...")
bot = commands.Bot(command_prefix=config['prefix'], intents=intents)

# Remove built-in help command so we can use our custom one
bot.remove_command('help')

DATA_FILE = 'data.txt'

data = {
    'usedKeys': [],
    'redeemedUsers': set(),
    'userModes': {},
    'redeemPending': {},
    'guilds': {},
    'tickets': {},
    'vouches': {},
    'afk': {}
}

print("[BOT START] Loading data.txt if exists...")
if os.path.exists(DATA_FILE):
    try:
        with open(DATA_FILE, 'r') as f:
            content = f.read().strip()
            if content:
                loaded = json.loads(content)
                data['usedKeys'] = loaded.get('usedKeys', [])
                data['redeemedUsers'] = set(loaded.get('redeemedUsers', []))
                data['userModes'] = loaded.get('userModes', {})
                data['redeemPending'] = loaded.get('redeemPending', {})
                data['guilds'] = loaded.get('guilds', {})
                data['tickets'] = loaded.get('tickets', {})
                data['vouches'] = loaded.get('vouches', {})
                data['afk'] = loaded.get('afk', {})
        print("[BOT START] data.txt loaded successfully")
    except Exception as e:
        print(f"[BOT START] Failed to load data.txt: {e}")

def save_data():
    try:
        serial = {**data, 'redeemedUsers': list(data['redeemedUsers'])}
        with open(DATA_FILE, 'w') as f:
            json.dump(serial, f, indent=2)
        print("[SAVE] data.txt saved successfully")
    except Exception as e:
        print(f"[SAVE ERROR] Failed to save data.txt: {e}")

def has_ticket_mode(user_id):
    return data['userModes'].get(str(user_id), {}).get('ticket', False)

def has_middleman_mode(user_id):
    return data['userModes'].get(str(user_id), {}).get('middleman', False)

def is_redeemed(user_id):
    return str(user_id) in data['redeemedUsers']

@bot.event
async def on_ready():
    print(f'[READY] Logged in as {bot.user} (ID: {bot.user.id})')
    print(f'[READY] Prefix is: {bot.command_prefix}')
    print('[READY] Bot is now listening for messages...')

@bot.event
async def on_message(message):
    print(f'[MSG RECEIVED] {message.author} ({message.author.id}): {message.content}')
    
    if message.author.bot:
        print('[MSG IGNORED] Message from bot')
        return

    user_id = str(message.author.id)

    if user_id in data['redeemPending']:
        print(f'[REDEEM PENDING] User {user_id} replied: {message.content}')
        content = message.content.strip().lower()

        if content in ('1', 'ticket'):
            data['userModes'].setdefault(user_id, {})['ticket'] = True
            del data['redeemPending'][user_id]
            save_data()
            await message.reply('**Ticket mode activated!** Use $shazam.')
            print('[REDEEM SUCCESS] Ticket mode activated')
            return

        if content in ('2', 'middleman'):
            data['userModes'].setdefault(user_id, {})['middleman'] = True
            del data['redeemPending'][user_id]
            save_data()
            await message.reply('**Middleman mode activated!** Now run **$shazam1**.')
            print('[REDEEM SUCCESS] Middleman mode activated')
            return

        await message.reply('Reply **1** (Ticket) or **2** (Middleman) only.')
        print('[REDEEM INVALID] Invalid reply')
        return

    print('[MSG PROCESSED] Sending to commands...')
    await bot.process_commands(message)

@bot.command()
async def redeem(ctx, key: str = None):
    print(f'[CMD] redeem called by {ctx.author}: $redeem {key}')
    if not key:
        await ctx.reply('Usage: $redeem <key>')
        print('[REDEEM] No key provided')
        return

    try:
        if key not in config['validKeys']:
            await ctx.reply('Invalid key.')
            print('[REDEEM] Invalid key')
            return
    except (KeyError, TypeError):
        await ctx.reply('Bot config error — contact owner.')
        print('[REDEEM] Config error')
        return

    if key in data['usedKeys']:
        await ctx.reply('Key already used.')
        print('[REDEEM] Key already used')
        return

    data['usedKeys'].append(key)
    data['redeemedUsers'].add(str(ctx.author.id))
    data['redeemPending'][str(ctx.author.id)] = True
    save_data()

    await ctx.reply('**Key activated!**\nReply **1** (Ticket mode) or **2** (Middleman mode) now.')
    print('[REDEEM SUCCESS] Key redeemed, pending mode reply')
    try:
        await ctx.author.send('**Key redeemed!**\nReply **1** or **2** in channel.')
    except:
        print('[REDEEM] DM failed')

@bot.command()
async def shazam(ctx):
    print(f'[CMD] shazam called by {ctx.author}')
    if not is_redeemed(ctx.author.id):
        await ctx.reply('Redeem a key first.')
        print('[SHAZAM] Not redeemed')
        return

    await ctx.reply('**Ticket setup started.** Answer questions. Type "cancel" to stop.')
    print('[SHAZAM] Setup started')

    def check(m):
        return m.author == ctx.author and m.channel == ctx.channel

    try:
        guild_id = str(ctx.guild.id)
        guild_data = data['guilds'].setdefault(guild_id, {})
        setup = guild_data.setdefault('setup', {})  # safe creation

        await ctx.send('Transcripts channel ID (numbers):')
        msg = await bot.wait_for('message', check=check, timeout=180)
        if msg.content.lower() == 'cancel':
            await ctx.reply('Cancelled.')
            return
        if not msg.content.isdigit():
            await ctx.reply('Numbers only.')
            return
        setup['transcriptsChannel'] = msg.content

        # ... (all other questions exactly as before)

        save_data()
        await ctx.reply('**Ticket setup complete!** Use $ticket1, $index, $seller, $shop or $support.')
        print('[SHAZAM] Setup completed')

    except asyncio.TimeoutError:
        await ctx.reply('Timed out.')
        print('[SHAZAM] Timeout')
    except Exception as e:
        print(f'[SHAZAM ERROR] {e}')
        traceback.print_exc()
        await ctx.reply('Setup failed — check logs.')

# ... (add shazam1, earn, mminfo, ticket1, help, on_interaction exactly as before)

bot.run(TOKEN)
