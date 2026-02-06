import discord
from discord.ext import commands
import json
import os
import asyncio
import io
from datetime import datetime

# Import views (create views.py with the code at the bottom of this message)
from views import RequestView, IndexRequestView

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
            "index_staff_role": None,   # ← changed to role ID
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


def is_owner(member):
    owner_role = config_data["config"].get("owner_role")
    return owner_role is not None and owner_role in [r.id for r in member.roles]


# =====================================================
# Events
# =====================================================
@bot.event
async def on_ready():
    print(f"Logged in as {bot.user} ({bot.user.id})")
    bot.add_view(RequestView(bot, config_data))
    bot.add_view(IndexRequestView(bot, config_data))
    print("Persistent views registered - buttons should appear")


# =====================================================
# Redeem + mode selection
# =====================================================
@bot.command()
async def redeem(ctx, *, key: str):
    if not key or key not in config_data["keys"]:
        await ctx.send("Invalid or already used key.")
        return

    print(f"[DEBUG] Redeem success: {ctx.author} used {key}")

    config_data["keys"].remove(key)
    config_data["used_keys"].append(key)
    config_data["activated_users"][str(ctx.author.id)] = {"mode": None}
    save_config(config_data)

    await ctx.send(
        "Valid key!\n\n"
        "Choose Mode:\n"
        "**1** = Middleman\n"
        "**2** = Ticket bot\n\n"
        "Reply **1** or **2** in this channel."
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
            print(f"[DEBUG] {message.author} replied: {content}")

            if content in ("1", "2"):
                mode = int(content)
                state["mode"] = mode
                save_config(config_data)

                reply = (
                    "**Middleman mode selected!**\nType **$setuptick** to start setup."
                    if mode == 1 else
                    "**Ticket bot mode selected!**\nType **$setuptick** to start setup."
                )
                await message.channel.send(reply)
                print(f"[DEBUG] Mode {mode} saved for {message.author}")
            else:
                await message.channel.send("Reply with **1** or **2** only.")

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

    print(f"[DEBUG] {ctx.author} started setup")

    questions = [
        ("Middleman role ID", "middleman_role"),
        ("Index staff **role** ID", "index_staff_role"),  # now role
        ("Staff role ID", "staff_role"),
        ("Owner Role ID", "owner_role"),
        ("Ticket category ID", "ticket_category"),
        ("Transcript channel ID", "transcript_channel")
    ]

    await ctx.send("**Setup started**\nAnswer with numbers only. Type `cancel` to stop.")

    for q_text, key in questions:
        await ctx.send(f"**{q_text}**\nReply with ID:")

        def check(m):
            return m.author.id == ctx.author.id and m.channel.id == ctx.channel.id

        try:
            msg = await bot.wait_for("message", check=check, timeout=180)
            if msg.content.lower() == "cancel":
                await ctx.send("Cancelled.")
                return

            if not msg.content.strip().isdigit():
                await ctx.send("Only numbers. Cancelled.")
                return

            config_data["config"][key] = int(msg.content.strip())
            save_config(config_data)
            await ctx.send(f"Saved: **{msg.content.strip()}**")

        except asyncio.TimeoutError:
            await ctx.send("Timed out. Cancelled.")
            return

    del config_data["activated_users"][uid]
    save_config(config_data)

    await ctx.send("**Setup done!** Use `$main` and `$index` now.")


# =====================================================
# Panels with fixed image + buttons
# =====================================================
@bot.command()
async def main(ctx):
    if not is_owner(ctx.author):
        await ctx.send("Only owner can use this.")
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
    embed.set_image(url="https://i.imgur.com/0oK9Z3L.gif")  # YOUR GIF
    embed.set_footer(text="Safe Trading Server")

    await ctx.send(embed=embed, view=RequestView(bot, config_data))


@bot.command()
async def index(ctx):
    if not is_owner(ctx.author):
        await ctx.send("Only owner can use this.")
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
    embed.set_image(url="https://i.imgur.com/0oK9Z3L.gif")  # YOUR GIF
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
