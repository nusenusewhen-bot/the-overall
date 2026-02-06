import discord
from discord.ext import commands
import json
import os
import asyncio
from datetime import datetime

# Your user ID as fallback owner (you can run commands even before setup)
FALLBACK_OWNER_ID = 1298640383688970293

# Import views
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
            "index_staff_role": None,
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


def is_owner(member: discord.Member) -> bool:
    owner_role = config_data["config"].get("owner_role")
    # Allow your user ID always + real owner role when set
    return (
        member.id == FALLBACK_OWNER_ID or
        (owner_role is not None and owner_role in [r.id for r in member.roles])
    )


def is_ticket_staff(member: discord.Member) -> bool:
    cfg = config_data["config"]
    roles = [r.id for r in member.roles]
    return (
        cfg.get("middleman_role") in roles or
        cfg.get("staff_role") in roles or
        member.id == cfg.get("index_staff_id")  # optional
    )


# =====================================================
# Events
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
        await ctx.send("Invalid or already used key.")
        return

    config_data["keys"].remove(key)
    config_data["used_keys"].append(key)
    config_data["activated_users"][str(ctx.author.id)] = {"mode": None}
    save_config(config_data)

    await ctx.send(
        "Valid key!\n\n"
        "Choose Mode:\n"
        "1 = Middleman\n"
        "2 = Ticket bot\n\n"
        "Reply with **1** or **2**."
    )


@bot.event
async def on_message(message):
    if message.author.bot:
        return

    uid = str(message.author.id)
    if uid in config_data["activated_users"]:
        state = config_data["activated_users"][uid]
        if state.get("mode") is None:
            content = message.content.strip()
            if content in ("1", "2"):
                mode = int(content)
                state["mode"] = mode
                save_config(config_data)
                reply = (
                    "Middleman mode selected! Type **$setuptick** to setup."
                    if mode == 1 else
                    "Ticket bot mode selected! Type **$setuptick** to setup."
                )
                await message.channel.send(reply)

    await bot.process_commands(message)


# =====================================================
# Setup wizard
# =====================================================
@bot.command(name="setuptick")
async def setuptick(ctx):
    uid = str(ctx.author.id)

    if uid not in config_data["activated_users"]:
        await ctx.send("Redeem a key first with `$redeem <key>`.")
        return

    state = config_data["activated_users"][uid]
    if state.get("mode") is None:
        await ctx.send("Choose mode first (reply 1 or 2).")
        return

    questions = [
        ("Middleman role ID", "middleman_role"),
        ("Index staff role ID", "index_staff_role"),
        ("Staff role ID", "staff_role"),
        ("Owner role ID", "owner_role"),
        ("Ticket category ID", "ticket_category"),
        ("Transcript channel ID", "transcript_channel")
    ]

    await ctx.send("**Setup started**\nAnswer with IDs. Type `cancel` to stop.")

    for q_text, key in questions:
        await ctx.send(f"**{q_text}**")

        def check(m):
            return m.author.id == ctx.author.id and m.channel.id == ctx.channel.id

        try:
            msg = await bot.wait_for("message", check=check, timeout=120.0)
            if msg.content.lower() == "cancel":
                await ctx.send("Setup cancelled.")
                return
            if not msg.content.strip().isdigit():
                await ctx.send("Only numbers allowed. Cancelled.")
                return

            config_data["config"][key] = int(msg.content.strip())
            save_config(config_data)
            await ctx.send(f"Saved: **{msg.content.strip()}**")

        except asyncio.TimeoutError:
            await ctx.send("Timed out. Cancelled.")
            return

    del config_data["activated_users"][uid]
    save_config(config_data)

    await ctx.send("**Setup complete!** Use `$main` and `$index`.")


# =====================================================
# Panels
# =====================================================
@bot.command()
async def main(ctx):
    if not is_owner(ctx.author):
        await ctx.send("Only owner can use this command.")
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
    embed.set_image(url="https://i.ibb.co/JF73d5JF/ezgif-4b693c75629087.gif")
    embed.set_footer(text="Safe Trading Server")

    await ctx.send(embed=embed, view=RequestView(bot, config_data))


@bot.command()
async def index(ctx):
    if not is_owner(ctx.author):
        await ctx.send("Only owner can use this command.")
        return

    cfg = config_data["config"]
    staff_mention = f"<@&{cfg.get('index_staff_role')}>" if cfg.get("index_staff_role") else "@Index Staff"

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
    embed.set_image(url="https://i.ibb.co/JF73d5JF/ezgif-4b693c75629087.gif")
    embed.set_footer(text="Indexing Service")

    await ctx.send(embed=embed, view=IndexRequestView(bot, config_data))


# =====================================================
# Start bot
# =====================================================
if __name__ == "__main__":
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        print("ERROR: DISCORD_TOKEN not set in environment variables")
        exit(1)

    print("Starting bot...")
    bot.run(token)
