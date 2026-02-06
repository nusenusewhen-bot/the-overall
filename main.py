import discord
from discord.ext import commands
import json
import os
import asyncio
import io
from datetime import datetime

# =====================================================
# Replace with your actual views.py content
# For now, minimal stubs so the bot runs without errors
# Add your full views later
# =====================================================
class RequestView(discord.ui.View):
    def __init__(self, bot, config):
        super().__init__(timeout=None)
        self.bot = bot
        self.config = config

class IndexRequestView(discord.ui.View):
    def __init__(self, bot, config):
        super().__init__(timeout=None)
        self.bot = bot
        self.config = config

class TicketControlView(discord.ui.View):
    def __init__(self, bot, config, claimed_by=None):
        super().__init__(timeout=None)
        self.bot = bot
        self.config = config
        self.claimed_by = claimed_by

# =====================================================
# Bot setup
# =====================================================
intents = discord.Intents.default()
intents.message_content = True
intents.members = True

bot = commands.Bot(command_prefix="$", intents=intents)

CONFIG_FILE = "config.json"


def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)

    default = {
        "keys": [],
        "used_keys": [],
        "activated_users": {},
        "config": {
            "middleman_role": None,
            "index_staff_id": None,
            "staff_role": None,
            "owner_role": None,
            "ticket_category": None,
            "transcript_channel": None
        }
    }
    save_config(default)
    return default


def save_config(data):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)


config_data = load_config()


# =====================================================
# Check if user is staff/middleman/index
# =====================================================
def is_ticket_staff(member):
    cfg = config_data["config"]
    roles = [r.id for r in member.roles]
    return (
        cfg.get("middleman_role") in roles or
        cfg.get("staff_role") in roles or
        member.id == cfg.get("index_staff_id")
    )


# =====================================================
# Events
# =====================================================
@bot.event
async def on_ready():
    print(f"Logged in as {bot.user} ({bot.user.id})")
    print("Bot is ready! Use $redeem <key> to test")
    # Register persistent views (even if stubs)
    bot.add_view(RequestView(bot, config_data))
    bot.add_view(IndexRequestView(bot, config_data))
    bot.add_view(TicketControlView(bot, config_data))


# =====================================================
# Redeem command + mode selection
# =====================================================
@bot.command()
async def redeem(ctx, *, key: str):
    if key not in config_data["keys"]:
        await ctx.send("Invalid or already used key.")
        return

    print(f"[DEBUG] Redeem success: {ctx.author} used key {key}")

    config_data["keys"].remove(key)
    config_data["used_keys"].append(key)
    config_data["activated_users"][str(ctx.author.id)] = {
        "mode": None,
        "channel_id": ctx.channel.id
    }
    save_config(config_data)

    await ctx.send(
        "Valid key!\n\n"
        "Choose Mode:\n"
        "1 = Middleman\n"
        "2 = Ticket bot\n\n"
        "Reply **1** or **2** in this channel (you have 2 minutes)."
    )


# =====================================================
# Mode selection in on_message
# =====================================================
@bot.event
async def on_message(message):
    if message.author.bot:
        return

    uid = str(message.author.id)

    if uid in config_data["activated_users"]:
        state = config_data["activated_users"][uid]
        if state.get("mode") is None:
            content = message.content.strip()
            print(f"[DEBUG] User {message.author} replied: '{content}'")

            if content in ("1", "2"):
                mode = int(content)
                state["mode"] = mode
                save_config(config_data)

                if mode == 1:
                    reply = "**Middleman mode selected!**\nType **$setuptick** to start setup."
                else:
                    reply = "**Ticket bot mode selected!**\nType **$setuptick** to start setup."

                await message.channel.send(reply)
                print(f"[DEBUG] Mode saved: {mode} for {message.author}")
            else:
                await message.channel.send("Please reply with **1** or **2** only.")

    await bot.process_commands(message)


# =====================================================
# Setup wizard
# =====================================================
@bot.command(name="setuptick")
async def setuptick(ctx):
    uid = str(ctx.author.id)

    if uid not in config_data["activated_users"]:
        await ctx.send("You need to redeem a key and choose mode first.")
        return

    state = config_data["activated_users"][uid]
    if state.get("mode") is None:
        await ctx.send("Choose mode first (reply 1 or 2 after redeem).")
        return

    print(f"[DEBUG] {ctx.author} started $setuptick")

    questions = [
        ("Middleman role ID", "middleman_role"),
        ("Index staff ID (user ID)", "index_staff_id"),
        ("Staff role ID", "staff_role"),
        ("Owner Role ID", "owner_role"),
        ("Ticket category ID", "ticket_category"),
        ("Transcript channel ID", "transcript_channel")
    ]

    await ctx.send(
        "**Setup wizard started!**\n"
        "Answer each question with a number (ID).\n"
        "Type `cancel` to stop at any time."
    )

    for q_text, q_key in questions:
        await ctx.send(f"**{q_text}**\nReply with the ID:")

        def check(m):
            return m.author.id == ctx.author.id and m.channel.id == ctx.channel.id

        try:
            msg = await bot.wait_for("message", check=check, timeout=180)
            content = msg.content.strip().lower()

            if content == "cancel":
                await ctx.send("Setup cancelled.")
                return

            if not content.isdigit():
                await ctx.send("Only numbers allowed. Setup cancelled.")
                return

            config_data["config"][q_key] = int(content)
            save_config(config_data)
            await ctx.send(f"✓ Saved **{q_text}**: {content}")

        except asyncio.TimeoutError:
            await ctx.send("No reply received. Setup cancelled.")
            return

    # Cleanup
    del config_data["activated_users"][uid]
    save_config(config_data)

    await ctx.send(
        "**Setup completed!**\n"
        "All settings saved.\n"
        "You can now use:\n"
        "• **$main** – trade panel\n"
        "• **$index** – indexing panel"
    )


# =====================================================
# Basic panel commands (owner only)
# =====================================================
@bot.command()
async def main(ctx):
    owner_role = config_data["config"].get("owner_role")
    if owner_role and owner_role not in [r.id for r in ctx.author.roles]:
        await ctx.send("Only the owner can use this command.")
        return

    embed = discord.Embed(
        title="Found a trade and would like to ensure a safe trading experience?",
        description=(
            "**Open a ticket below**\n\n"
            "**What we provide**\n"
            "• We provide safe traders between 2 parties\n"
            "• We provide fast and easy deals\n\n"
            "**Important notes**\n"
            "• Both parties must agree before opening a ticket\n"
            "• Fake/Troll tickets will result into a ban or ticket blacklist\n"
            "• Follow discord ToS and server guidelines"
        ),
        color=discord.Color.blue()
    )
    embed.set_image(url="https://i.imgur.com/1pZ1q2J.png")
    embed.set_footer(text="Safe Trading Server")

    await ctx.send(embed=embed, view=RequestView(bot, config_data))


@bot.command()
async def index(ctx):
    owner_role = config_data["config"].get("owner_role")
    if owner_role and owner_role not in [r.id for r in ctx.author.roles]:
        await ctx.send("Only the owner can use this command.")
        return

    cfg = config_data["config"]
    staff_mention = f"<@{cfg.get('index_staff_id')}>" if cfg.get("index_staff_id") else "@Index Staff"

    embed = discord.Embed(
        title="Indexing Services",
        description=(
            f"• Open this ticket if you would like Indexing service to help finish your index and complete your base.\n\n"
            f"• You're going to have to pay first before we let you start indexing.\n\n"
            f"**When opening a ticket:**\n"
            f"• Wait for a {staff_mention} to answer your ticket.\n"
            "• Be nice and kind to the staff and be patient.\n"
            "• State your roblox username on the account you want to complete the index in.\n\n"
            "If not following so your ticket will be deleted and you will be timed out for 1 hour ♥️"
        ),
        color=discord.Color.blue()
    )
    embed.set_image(url="https://i.imgur.com/1pZ1q2J.png")
    embed.set_footer(text="Indexing Service")

    await ctx.send(embed=embed, view=IndexRequestView(bot, config_data))


# =====================================================
# Start bot
# =====================================================
if __name__ == "__main__":
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        print("ERROR: DISCORD_TOKEN not found in environment variables")
        print("Railway → Variables tab → add DISCORD_TOKEN")
        print("Local → set/export DISCORD_TOKEN=your.token")
        exit(1)

    print("Starting bot...")
    bot.run(token)
