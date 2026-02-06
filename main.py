import discord
from discord.ext import commands
import json
import os
import asyncio
import io
from datetime import datetime

# Import views (create views.py with the content below)
from views import RequestView, IndexRequestView, TicketControlView

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


def is_ticket_staff(member: discord.Member) -> bool:
    cfg = config_data["config"]
    roles = [r.id for r in member.roles]
    return (
        cfg["middleman_role"] in roles or
        cfg["staff_role"] in roles or
        member.id == cfg["index_staff_id"]
    )


# =====================================================
# Persistent views registration
# =====================================================
@bot.event
async def on_ready():
    print(f"Logged in as {bot.user} ({bot.user.id})")
    bot.add_view(RequestView(bot, config_data))
    bot.add_view(IndexRequestView(bot, config_data))
    bot.add_view(TicketControlView(bot, config_data))
    print("Persistent views registered")


# =====================================================
# Redeem & mode selection
# =====================================================
@bot.command()
async def redeem(ctx, *, key: str):
    if key not in config_data["keys"]:
        await ctx.send("Invalid or already used key.", delete_after=10)
        return

    config_data["keys"].remove(key)
    config_data["used_keys"].append(key)
    config_data["activated_users"][str(ctx.author.id)] = {"mode": None}
    save_config(config_data)

    await ctx.send(
        "Valid key!\n\n"
        "Choose Mode:\n"
        "**1** = Middleman\n"
        "**2** = Ticket bot\n\n"
        "Reply with **1** or **2** in this channel."
    )


# =====================================================
# Setup tick wizard
# =====================================================
@bot.command(name="setuptick")
async def setuptick(ctx):
    uid = str(ctx.author.id)

    if uid not in config_data["activated_users"]:
        await ctx.send("You must redeem a key first with `$redeem <key>`.")
        return

    state = config_data["activated_users"][uid]
    if state.get("mode") is None:
        await ctx.send("Please choose your mode first (reply 1 or 2 after redeem).")
        return

    # Optional: after setup, only owner can run again
    owner_role = config_data["config"].get("owner_role")
    if owner_role is not None:
        if owner_role not in [r.id for r in ctx.author.roles]:
            await ctx.send("Setup can only be completed by the authorized user once.")
            return

    questions = [
        ("Middleman role ID", "middleman_role"),
        ("Index staff ID (user ID)", "index_staff_id"),
        ("Staff role ID", "staff_role"),
        ("Owner Role ID", "owner_role"),
        ("Ticket category ID", "ticket_category"),
        ("Transcript channel ID", "transcript_channel")
    ]

    await ctx.send("Starting **$setuptick** setup wizard.\n"
                   "Answer each question with a valid **ID number**.\n"
                   "Only you can reply. Type `cancel` to stop.")

    for question_text, key in questions:
        await ctx.send(f"**{question_text}**\nReply with the ID:")

        def check(m):
            return m.author.id == ctx.author.id and m.channel.id == ctx.channel.id

        try:
            msg = await bot.wait_for("message", check=check, timeout=180.0)  # 3 min timeout
            content = msg.content.strip()

            if content.lower() == "cancel":
                await ctx.send("Setup cancelled.")
                return

            if not content.isdigit():
                await ctx.send("Please reply with a number (ID) only. Setup cancelled.")
                return

            config_data["config"][key] = int(content)
            save_config(config_data)

            await ctx.send(f"✓ Saved: {question_text} → **{content}**")

        except asyncio.TimeoutError:
            await ctx.send("No reply received. Setup cancelled.")
            return

    # Cleanup activation
    del config_data["activated_users"][uid]
    save_config(config_data)

    await ctx.send("**Setup completed successfully!**\n"
                   "All values saved to config.json.\n"
                   "You can now use `$main` and `$index`.")


# =====================================================
# Simple panel commands (owner only after setup)
# =====================================================
@bot.command()
async def main(ctx):
    owner_role = config_data["config"].get("owner_role")
    if owner_role is not None:
        if owner_role not in [r.id for r in ctx.author.roles]:
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
            "• Follow discord Terms of service and server guidelines"
        ),
        color=discord.Color.blue()
    )
    embed.set_image(url="https://i.imgur.com/1pZ1q2J.png")
    embed.set_footer(text="Safe Trading Server")

    await ctx.send(embed=embed, view=RequestView(bot, config_data))


@bot.command()
async def index(ctx):
    owner_role = config_data["config"].get("owner_role")
    if owner_role is not None:
        if owner_role not in [r.id for r in ctx.author.roles]:
            await ctx.send("Only the owner can use this command.")
            return

    cfg = config_data["config"]
    staff_mention = f"<@{cfg['index_staff_id']}>" if cfg["index_staff_id"] else "@Index Staff"

    embed = discord.Embed(
        title="Indexing Services",
        description=(
            f"• Open this ticket if you would like a Indexing service to help finish your index and complete your base.\n\n"
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
# BOT START – Token from environment variable
# =====================================================
if __name__ == "__main__":
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        print("ERROR: DISCORD_TOKEN is not set in environment variables!")
        print("On Railway: Add it in the Variables tab")
        print("Locally: export DISCORD_TOKEN=your.token.here (Linux/Mac)")
        print("          set DISCORD_TOKEN=your.token.here (Windows)")
        exit(1)

    print("Starting bot...")
    bot.run(token)
