import discord
from discord.ext import commands
import json
import os
from dotenv import load_dotenv
import asyncio
import traceback
import sys

print("[BOT START] Loading environment...")
load_dotenv()
TOKEN = os.getenv('TOKEN')
if not TOKEN:
    print("[CRITICAL] No TOKEN found!")
    sys.exit(1)

print("[BOT START] Loading config...")
try:
    with open('config.json', 'r') as f:
        config = json.load(f)
    print("[BOT START] config loaded")
except Exception as e:
    print(f"[CRITICAL] config.json error: {e}")
    sys.exit(1)

intents = discord.Intents.default()
intents.message_content = True
intents.members = True

bot = commands.Bot(command_prefix=config['prefix'], intents=intents)
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
                data.update({
                    'usedKeys': loaded.get('usedKeys', []),
                    'redeemedUsers': set(loaded.get('redeemedUsers', [])),
                    'userModes': loaded.get('userModes', {}),
                    'redeemPending': loaded.get('redeemPending', {}),
                    'guilds': loaded.get('guilds', {}),
                    'tickets': loaded.get('tickets', {}),
                    'vouches': loaded.get('vouches', {}),
                    'afk': loaded.get('afk', {})
                })
        print("[START] data.txt loaded")
    except Exception as e:
        print(f"[START] data.txt load failed: {e}")

def save_data():
    try:
        serial = {**data, 'redeemedUsers': list(data['redeemedUsers'])}
        with open(DATA_FILE, 'w') as f:
            json.dump(serial, f, indent=2)
        print("[SAVE] data.txt saved")
    except Exception as e:
        print(f"[SAVE ERROR] {e}")

def has_ticket_mode(user_id):
    return data['userModes'].get(str(user_id), {}).get('ticket', False)

def has_middleman_mode(user_id):
    return data['userModes'].get(str(user_id), {}).get('middleman', False)

def is_redeemed(user_id):
    return str(user_id) in data['redeemedUsers']

@bot.event
async def on_ready():
    print(f'[READY] Logged in as {bot.user} (ID: {bot.user.id})')
    print(f'[READY] Prefix: {bot.command_prefix}')

@bot.event
async def on_message(message):
    print(f'[MSG] {message.author} ({message.author.id}) in {message.channel.name}: {message.content}')
    if message.author.bot:
        return
    await bot.process_commands(message)

@bot.event
async def on_command_error(ctx, error):
    print(f'[CMD ERROR] {ctx.command} failed for {ctx.author}: {error}')
    traceback.print_exc()
    if isinstance(error, commands.CommandNotFound):
        return
    await ctx.send(f"Error: `{error}`", delete_after=10)

@bot.command()
async def redeem(ctx, key: str = None):
    print(f'[CMD] redeem by {ctx.author}: key={key}')
    if not key:
        await ctx.reply('Usage: $redeem <key>')
        return

    if key not in config['validKeys']:
        await ctx.reply('Invalid key.')
        return

    if key in data['usedKeys']:
        await ctx.reply('Key already used.')
        return

    data['usedKeys'].append(key)
    data['redeemedUsers'].add(str(ctx.author.id))
    data['redeemPending'][str(ctx.author.id)] = True
    save_data()

    await ctx.reply('**Key activated!**\nReply **1** (Ticket mode) or **2** (Middleman mode) now.')
    print('[REDEEM] Success - waiting for mode reply')

@bot.command()
async def shazam(ctx):
    print(f'[CMD] shazam by {ctx.author}')
    if not is_redeemed(ctx.author.id):
        await ctx.reply('Redeem a key first.')
        return

    await ctx.reply('**Ticket setup started.** Answer questions. Type "cancel" to stop.')

    def check(m):
        return m.author == ctx.author and m.channel == ctx.channel

    try:
        guild_id = str(ctx.guild.id)
        guild_data = data['guilds'].setdefault(guild_id, {})
        setup = guild_data.setdefault('setup', {})

        questions = [
            ('Transcripts channel ID (numbers):', lambda x: x.isdigit(), 'transcriptsChannel'),
            ('Middleman role ID (numbers):', lambda x: x.isdigit(), 'middlemanRole'),
            ('Index Middleman role ID (numbers):', lambda x: x.isdigit() or x.lower() == 'cancel', 'indexMiddlemanRole'),
            ('Ticket category ID (numbers):', lambda x: x.isdigit() or x.lower() == 'cancel', 'ticketCategory'),
            ('Co-owner role ID (numbers):', lambda x: x.isdigit() or x.lower() == 'cancel', 'coOwnerRole'),
            ('Verification link (https://...) or "skip":', lambda x: x.startswith('https://') or x.lower() in ('skip', 'cancel'), 'verificationLink'),
            ('Hitter role ID (numbers):', lambda x: x.isdigit(), 'hitterRole'),
            ('Guide channel ID (numbers):', lambda x: x.isdigit(), 'guideChannel'),
            ('Staff role id (numbers only):', lambda x: x.isdigit(), 'staffRole'),
        ]

        for q_text, validator, key in questions:
            await ctx.send(q_text)
            msg = await bot.wait_for('message', check=check, timeout=180)
            ans = msg.content.strip()
            if ans.lower() == 'cancel':
                await ctx.reply('Cancelled.')
                return
            if not validator(ans):
                await ctx.reply('Invalid input.')
                return
            if key and ans.lower() not in ('skip', 'cancel'):
                setup[key] = ans

        save_data()
        await ctx.reply('**Ticket setup complete!** Use $ticket1, $index, $seller, $shop or $support.')
        print('[SHAZAM] Setup completed')

    except asyncio.TimeoutError:
        await ctx.reply('Timed out.')
    except Exception as e:
        print(f'[SHAZAM ERROR] {e}')
        traceback.print_exc()
        await ctx.reply('Setup failed — check logs.')

@bot.command()
async def earn(ctx):
    print(f'[CMD] earn by {ctx.author}')
    if not is_redeemed(ctx.author.id) or not has_middleman_mode(ctx.author.id):
        await ctx.reply('You need middleman mode + role.')
        return

    embed = discord.Embed(
        color=0xFF0000,
        title='Want to join us?',
        description='You just got scammed! Wanna be a hitter like us? 😈\n\n1. Find victim\n2. Get them to use our MM service\n3. Middleman helps scam\n4. Split 50/50\n\nRead guide channel.\n\n**STAFF:** Click below!'
    )
    embed.set_footer(text='Hitter Recruitment')

    view = discord.ui.View()
    view.add_item(discord.ui.Button(label='Join Us', style=discord.ButtonStyle.primary, custom_id='join_hitter'))
    view.add_item(discord.ui.Button(label='Not Interested', style=discord.ButtonStyle.danger, custom_id='not_interested_hitter'))

    await ctx.send(embed=embed, view=view)

@bot.command()
async def mminfo(ctx):
    print(f'[CMD] mminfo by {ctx.author}')
    embed = discord.Embed(
        color=0x000000,
        title='Middleman Service Info',
        description='A Middleman ensures fair trades.\n\nExample: Trading 2k Robux for Crow?\nMM holds Crow until payment confirmed.\n\nBenefits: Prevents scams, smooth transactions.'
    )
    embed.set_image(url='https://raw.githubusercontent.com/nusenusewhen-bot/the-overall/main/image-34.png')
    embed.set_footer(text='Middleman Service • Secure Trades')

    view = discord.ui.View()
    view.add_item(discord.ui.Button(label='Understood', style=discord.ButtonStyle.success, custom_id='understood_mm'))
    view.add_item(discord.ui.Button(label="Didn't Understand", style=discord.ButtonStyle.danger, custom_id='didnt_understand_mm'))

    await ctx.send(embed=embed, view=view)

@bot.command()
async def ticket1(ctx):
    print(f'[CMD] ticket1 by {ctx.author}')
    embed = discord.Embed(
        color=0x0088ff,
        description="Found a trade? Open a ticket below!\n\nWhat we provide:\n• Safe traders\n• Fast deals\n\nImportant:\n• Both parties agree\n• No fake tickets\n• Follow ToS"
    )
    embed.set_image(url="https://i.postimg.cc/8D3YLBgX/ezgif-4b693c75629087.gif")
    embed.set_footer(text="Safe Trading Server")

    view = discord.ui.View()
    view.add_item(discord.ui.Button(label='Request', style=discord.ButtonStyle.primary, emoji='📩', custom_id='request_ticket'))

    await ctx.send(embed=embed, view=view)

@bot.command()
async def help(ctx):
    print(f'[CMD] help by {ctx.author}')
    embed = discord.Embed(color=0x0099ff, title="Bot Commands", description="Prefix: $")
    embed.add_field(name="Setup", value="$shazam — Ticket setup\n$shazam1 — Middleman setup", inline=False)
    embed.add_field(name="Middleman", value="$earn\n$mmfee\n$mminfo", inline=False)
    embed.add_field(name="Tickets", value="$ticket1\n$index\n$seller\n$shop\n$support", inline=False)
    embed.add_field(name="In tickets", value="$add @user\n$claim\n$unclaim\n$transfer @user\n$close", inline=False)
    await ctx.send(embed=embed)

@bot.event
async def on_interaction(interaction):
    print(f'[INTERACTION] custom_id={interaction.data.get("custom_id")}')
    if interaction.type != discord.InteractionType.component:
        return

    guild_id = str(interaction.guild.id)
    setup = data['guilds'].get(guild_id, {}).get('setup', {})

    if interaction.data['custom_id'] == 'join_hitter':
        member = interaction.user
        hitter_role_id = setup.get('hitterRole')
        if not hitter_role_id:
            await interaction.response.send_message('Hitter role not set.', ephemeral=True)
            return

        role = interaction.guild.get_role(int(hitter_role_id))
        if not role:
            await interaction.response.send_message('Hitter role not found.', ephemeral=True)
            return

        already_had = role in member.roles

        if not already_had:
            try:
                await member.add_roles(role)
            except:
                await interaction.response.send_message('Failed to add role.', ephemeral=True)
                return

        await interaction.response.send_message(
            f"{member.mention} {'already has' if already_had else 'now has'} the Hitter role!",
            ephemeral=False
        )

        if not already_had:
            guide_id = setup.get('guideChannel')
            if guide_id:
                guide = interaction.guild.get_channel(int(guide_id))
                if guide:
                    link = setup.get('verificationLink', '(not set)')
                    await guide.send(f"{member.mention} joined hitters!\n\nWelcome!\n\nVerification: {link}\n\nPing staff if needed.")

    elif interaction.data['custom_id'] in ('understood_mm', 'didnt_understand_mm'):
        text = 'understood' if interaction.data['custom_id'] == 'understood_mm' else "didn't understand"
        await interaction.response.send_message(f"{interaction.user.mention} {text} the middleman service.", ephemeral=False)

    elif interaction.data['custom_id'] == 'request_ticket':
        modal = discord.ui.Modal(title="Trade Ticket Form")
        modal.add_item(discord.ui.TextInput(label="Other person's ID / username?", required=True))
        modal.add_item(discord.ui.TextInput(label="Describe the trade", style=discord.TextStyle.paragraph, required=True))
        modal.add_item(discord.ui.TextInput(label="Can both join private servers?", required=False))
        await interaction.response.send_modal(modal)

bot.run(TOKEN)
