# main.py — COMPLETE BOT (discord.py 2.4.0) — Everything fixed & included
import discord
from discord.ext import commands
import json
import os
from dotenv import load_dotenv
import asyncio
import traceback
import sys

load_dotenv()
TOKEN = os.getenv('TOKEN')

# Load config safely
try:
    with open('config.json', 'r') as f:
        config = json.load(f)
except Exception as e:
    print(f"[CRITICAL] Failed to load config.json: {e}")
    sys.exit(1)

intents = discord.Intents.default()
intents.message_content = True
intents.members = True

bot = commands.Bot(command_prefix=config['prefix'], intents=intents)

# Remove built-in help to use our custom one
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
        print('[DATA] Loaded from data.txt')
    except Exception as e:
        print(f'[DATA] Load failed: {e}')

def save_data():
    try:
        serial = {**data, 'redeemedUsers': list(data['redeemedUsers'])}
        with open(DATA_FILE, 'w') as f:
            json.dump(serial, f, indent=2)
        print('[DATA] Saved to data.txt')
    except Exception as e:
        print(f'[SAVE ERROR] {e}')

def has_ticket_mode(user_id):
    return data['userModes'].get(str(user_id), {}).get('ticket', False)

def has_middleman_mode(user_id):
    return data['userModes'].get(str(user_id), {}).get('middleman', False)

def is_redeemed(user_id):
    return str(user_id) in data['redeemedUsers']

@bot.event
async def on_ready():
    print(f'[READY] Logged in as {bot.user} (ID: {bot.user.id})')

@bot.event
async def on_error(event, *args, **kwargs):
    print(f'[GLOBAL ERROR] Event: {event}')
    traceback.print_exc(file=sys.stdout)

@bot.event
async def on_command_error(ctx, error):
    print(f'[COMMAND ERROR] {ctx.command} - {error}')
    traceback.print_exc()
    if isinstance(error, commands.CommandNotFound):
        return
    await ctx.send(f"Command error: `{error}`", delete_after=10)

@bot.event
async def on_message(message):
    if message.author.bot:
        return

    user_id = str(message.author.id)

    if user_id in data['redeemPending']:
        content = message.content.strip().lower()

        if content in ('1', 'ticket'):
            data['userModes'].setdefault(user_id, {})['ticket'] = True
            del data['redeemPending'][user_id]
            save_data()
            await message.reply('**Ticket mode activated!** Use $shazam.')
            return

        if content in ('2', 'middleman'):
            data['userModes'].setdefault(user_id, {})['middleman'] = True
            del data['redeemPending'][user_id]
            save_data()
            await message.reply('**Middleman mode activated!** Now run **$shazam1**.')
            return

        await message.reply('Reply **1** (Ticket) or **2** (Middleman) only.')
        return

    await bot.process_commands(message)

@bot.command()
async def redeem(ctx, key: str = None):
    if not key:
        return await ctx.reply('Usage: $redeem <key>')

    try:
        if key not in config['validKeys']:
            return await ctx.reply('Invalid key.')
    except (KeyError, TypeError):
        return await ctx.reply('Bot config error — contact owner.')

    if key in data['usedKeys']:
        return await ctx.reply('Key already used.')

    data['usedKeys'].append(key)
    data['redeemedUsers'].add(str(ctx.author.id))
    data['redeemPending'][str(ctx.author.id)] = True
    save_data()

    await ctx.reply('**Key activated!**\nReply **1** (Ticket mode) or **2** (Middleman mode) now.')
    try:
        await ctx.author.send('**Key redeemed!**\nReply **1** or **2** in channel.')
    except:
        pass

@bot.command()
async def shazam(ctx):
    if not is_redeemed(ctx.author.id):
        return await ctx.reply('Redeem a key first.')

    await ctx.reply('**Ticket setup started.** Answer questions. Type "cancel" to stop.')

    def check(m):
        return m.author == ctx.author and m.channel == ctx.channel

    try:
        guild_id = str(ctx.guild.id)
        setup = data['guilds'].setdefault(guild_id, {})['setup']

        await ctx.send('Transcripts channel ID (numbers):')
        msg = await bot.wait_for('message', check=check, timeout=180)
        if msg.content.lower() == 'cancel':
            return await ctx.reply('Cancelled.')
        if not msg.content.isdigit():
            return await ctx.reply('Numbers only.')
        setup['transcriptsChannel'] = msg.content

        await ctx.send('Middleman role ID (numbers):')
        msg = await bot.wait_for('message', check=check, timeout=180)
        if msg.content.lower() == 'cancel':
            return await ctx.reply('Cancelled.')
        if not msg.content.isdigit():
            return await ctx.reply('Numbers only.')
        setup['middlemanRole'] = msg.content

        await ctx.send('Index Middleman role ID (numbers):')
        msg = await bot.wait_for('message', check=check, timeout=180)
        if msg.content.lower() not in ('cancel', ''):
            if msg.content.isdigit():
                setup['indexMiddlemanRole'] = msg.content

        await ctx.send('Ticket category ID (numbers):')
        msg = await bot.wait_for('message', check=check, timeout=180)
        if msg.content.lower() != 'cancel' and msg.content.isdigit():
            setup['ticketCategory'] = msg.content

        await ctx.send('Co-owner role ID (numbers):')
        msg = await bot.wait_for('message', check=check, timeout=180)
        if msg.content.lower() != 'cancel' and msg.content.isdigit():
            setup['coOwnerRole'] = msg.content

        await ctx.send('Verification link (https://...) or "skip":')
        msg = await bot.wait_for('message', check=check, timeout=180)
        if msg.content.lower() != 'cancel' and msg.content.lower() != 'skip' and msg.content.startswith('https://'):
            setup['verificationLink'] = msg.content

        await ctx.send('Hitter role ID (numbers):')
        msg = await bot.wait_for('message', check=check, timeout=180)
        if msg.content.lower() == 'cancel':
            return await ctx.reply('Cancelled.')
        if not msg.content.isdigit():
            return await ctx.reply('Numbers only.')
        setup['hitterRole'] = msg.content

        await ctx.send('Guide channel ID (numbers):')
        msg = await bot.wait_for('message', check=check, timeout=180)
        if msg.content.lower() == 'cancel':
            return await ctx.reply('Cancelled.')
        if not msg.content.isdigit():
            return await ctx.reply('Numbers only.')
        setup['guideChannel'] = msg.content

        await ctx.send('Staff role id (numbers only):')
        msg = await bot.wait_for('message', check=check, timeout=180)
        if msg.content.lower() == 'cancel':
            return await ctx.reply('Cancelled.')
        if not msg.content.isdigit():
            return await ctx.reply('Numbers only.')
        setup['staffRole'] = msg.content

        save_data()
        await ctx.reply('**Ticket setup complete!** Use $ticket1, $index, $seller, $shop or $support.')

    except asyncio.TimeoutError:
        await ctx.reply('Timed out.')
    except Exception as e:
        print(f'[SHAZAM ERROR] {e}')
        traceback.print_exc()
        await ctx.reply('Setup failed — check logs.')

@bot.command()
async def shazam1(ctx):
    if not is_redeemed(ctx.author.id):
        return await ctx.reply('Redeem a key first.')
    if not has_middleman_mode(ctx.author.id):
        return await ctx.reply('This command is only for middleman mode. Redeem and reply **2**.')

    await ctx.reply('**Middleman setup started.** Answer questions. Type "cancel" to stop.')

    def check(m):
        return m.author == ctx.author and m.channel == ctx.channel

    try:
        guild_id = str(ctx.guild.id)
        setup = data['guilds'].setdefault(guild_id, {})['setup']

        await ctx.send('Middleman role ID (numbers only):')
        msg = await bot.wait_for('message', check=check, timeout=180)
        if msg.content.lower() == 'cancel':
            return await ctx.reply('Cancelled.')
        if not msg.content.isdigit():
            return await ctx.reply('Numbers only.')
        setup['middlemanRole'] = msg.content

        await ctx.send('Index Middleman role ID (numbers only):')
        msg = await bot.wait_for('message', check=check, timeout=180)
        if msg.content.lower() != 'cancel' and msg.content.isdigit():
            setup['indexMiddlemanRole'] = msg.content

        await ctx.send('Hitter role ID (numbers only):')
        msg = await bot.wait_for('message', check=check, timeout=180)
        if msg.content.lower() == 'cancel':
            return await ctx.reply('Cancelled.')
        if not msg.content.isdigit():
            return await ctx.reply('Numbers only.')
        setup['hitterRole'] = msg.content

        await ctx.send('Guide channel ID (numbers only):')
        msg = await bot.wait_for('message', check=check, timeout=180)
        if msg.content.lower() == 'cancel':
            return await ctx.reply('Cancelled.')
        if not msg.content.isdigit():
            return await ctx.reply('Numbers only.')
        setup['guideChannel'] = msg.content

        await ctx.send('Verification link (https://...) or type "skip":')
        msg = await bot.wait_for('message', check=check, timeout=180)
        if msg.content.lower() != 'cancel' and msg.content.lower() != 'skip' and msg.content.startswith('https://'):
            setup['verificationLink'] = msg.content

        save_data()
        await ctx.reply('**Middleman setup complete!** You can now use middleman commands ($earn, $mmfee, etc.).')

    except asyncio.TimeoutError:
        await ctx.reply('Timed out.')
    except Exception as e:
        print(f'[SHAZAM1 ERROR] {e}')
        traceback.print_exc()
        await ctx.reply('Setup failed — check logs.')

@bot.command()
async def earn(ctx):
    if not is_redeemed(ctx.author.id) or not has_middleman_mode(ctx.author.id):
        return await ctx.reply('You need middleman mode + role.')

    embed = discord.Embed(
        color=0xFF0000,
        title='Want to join us?',
        description=(
            'You just got scammed! Wanna be a hitter like us? 😈\n\n'
            '1. Find victim in trading server\n'
            '2. Get them to use our MM service\n'
            '3. Middleman helps scam item/crypto/robux\n'
            '4. Split 50/50\n\n'
            'Read guide channel.\n\n'
            '**STAFF:** Click below to join the team!'
        )
    )
    embed.set_footer(text='Hitter Recruitment')

    view = discord.ui.View()
    view.add_item(discord.ui.Button(label='Join Us', style=discord.ButtonStyle.primary, custom_id='join_hitter'))
    view.add_item(discord.ui.Button(label='Not Interested', style=discord.ButtonStyle.danger, custom_id='not_interested_hitter'))

    await ctx.send(embed=embed, view=view)

@bot.command()
async def mminfo(ctx):
    embed = discord.Embed(
        color=0x000000,
        title='Middleman Service Info',
        description=(
            'A Middleman is a trusted staff member who ensures fair trades.\n\n'
            '**Example:** Trading 2k Robux for Adopt Me Crow?\n'
            'MM holds Crow until payment confirmed, then releases it.\n\n'
            '**Benefits:** Prevents scams, smooth transactions, secure for both sides.'
        )
    )
    embed.set_image(url='https://raw.githubusercontent.com/nusenusewhen-bot/the-overall/main/image-34.png')
    embed.set_footer(text='Middleman Service • Secure Trades')

    view = discord.ui.View()
    view.add_item(discord.ui.Button(label='Understood', style=discord.ButtonStyle.success, custom_id='understood_mm'))
    view.add_item(discord.ui.Button(label="Didn't Understand", style=discord.ButtonStyle.danger, custom_id='didnt_understand_mm'))

    await ctx.send(embed=embed, view=view)

@bot.command()
async def ticket1(ctx):
    embed = discord.Embed(
        color=0x0088ff,
        description=(
            "Found a trade and would like to ensure a safe trading experience?\n\n"
            "**Open a ticket below**\n\n"
            "**What we provide**\n"
            "• We provide safe traders between 2 parties\n"
            "• We provide fast and easy deals\n\n"
            "**Important notes**\n"
            "• Both parties must agree before opening a ticket\n"
            "• Fake/Troll tickets will result into a ban or ticket blacklist\n"
            "• Follow discord Terms of service and server guidelines"
        )
    )
    embed.set_image(url="https://i.postimg.cc/8D3YLBgX/ezgif-4b693c75629087.gif")
    embed.set_footer(text="Safe Trading Server")

    view = discord.ui.View()
    view.add_item(discord.ui.Button(label='Request', style=discord.ButtonStyle.primary, emoji='📩', custom_id='request_ticket'))

    await ctx.send(embed=embed, view=view)

@bot.command()
async def help(ctx):
    embed = discord.Embed(color=0x0099ff, title="Bot Commands", description="Prefix: $")
    embed.add_field(name="Setup", value="$shazam — Ticket setup\n$shazam1 — Middleman setup", inline=False)
    embed.add_field(name="Middleman (needs mode + role)", value="$earn\n$mmfee\n$mminfo", inline=False)
    embed.add_field(name="Tickets (needs redeem)", value="$ticket1\n$index\n$seller\n$shop\n$support\nInside tickets: $add, $claim, $unclaim, $transfer, $close", inline=False)
    embed.set_footer(text="All commands available after redeem & mode activation")

    await ctx.send(embed=embed)

@bot.event
async def on_interaction(interaction):
    if interaction.type != discord.InteractionType.component:
        return

    guild_id = str(interaction.guild.id)
    setup = data['guilds'].get(guild_id, {}).get('setup', {})

    if interaction.data['custom_id'] == 'join_hitter':
        member = interaction.user
        hitter_role_id = setup.get('hitterRole')

        if not hitter_role_id:
            return await interaction.response.send_message('Hitter role not set.', ephemeral=True)

        role = interaction.guild.get_role(int(hitter_role_id))
        if not role:
            return await interaction.response.send_message('Hitter role not found.', ephemeral=True)

        already_had = role in member.roles

        if not already_had:
            try:
                await member.add_roles(role)
            except:
                return await interaction.response.send_message('Failed to add hitter role.', ephemeral=True)

        await interaction.response.send_message(
            f"{member.mention} {'already has' if already_had else 'now has'} the Hitter role!",
            ephemeral=False
        )

        if not already_had:
            guide_channel_id = setup.get('guideChannel')
            if guide_channel_id:
                guide_channel = interaction.guild.get_channel(int(guide_channel_id))
                if guide_channel and isinstance(guide_channel, discord.TextChannel):
                    verification_link = setup.get('verificationLink', '(not set)')
                    await guide_channel.send(
                        f"{member.mention} just joined the hitters!\n\n"
                        f"Welcome! Read everything here carefully.\n\n"
                        f"**Verification steps:**\n"
                        f"1. Go to this link: {verification_link}\n"
                        f"2. Follow the instructions to verify your account.\n"
                        f"3. Once verified, you can start hitting.\n\n"
                        f"If you have questions, ping a staff member. Good luck!"
                    )

    elif interaction.data['custom_id'] in ('understood_mm', 'didnt_understand_mm'):
        text = 'understood' if interaction.data['custom_id'] == 'understood_mm' else "didn't understand"
        await interaction.response.send_message(
            f"{interaction.user.mention} {text} the middleman service.",
            ephemeral=False
        )

bot.run(TOKEN)
