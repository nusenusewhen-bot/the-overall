import discord
from discord.ext import commands
import json
import os
import asyncio
from datetime import datetime

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
    if owner_role is None:
        return True  # fallback so you can test
    return owner_role in [r.id for r in member.roles]


def is_ticket_staff(member: discord.Member) -> bool:
    cfg = config_data["config"]
    roles = [r.id for r in member.roles]
    return (
        cfg.get("middleman_role") in roles or
        cfg.get("staff_role") in roles
    )


# =====================================================
# Ticket creation function - GLOBAL in main.py
# =====================================================
async def create_ticket(interaction: discord.Interaction, modal, is_index: bool = False):
    cfg = config_data["config"]
    category = interaction.guild.get_channel(cfg["ticket_category"])

    if not category:
        await interaction.followup.send("Ticket category not set in config.", ephemeral=True)
        return

    prefix = "index-" if is_index else "trade-"
    name = f"{prefix}{interaction.user.name.lower().replace(' ', '-')[:20]}"

    overwrites = {
        interaction.guild.default_role: discord.PermissionOverwrite(view_channel=False),
        interaction.user: discord.PermissionOverwrite(view_channel=True, send_messages=True),
    }

    for key in ["middleman_role", "staff_role", "owner_role"]:
        rid = cfg.get(key)
        if rid:
            role = interaction.guild.get_role(rid)
            if role:
                overwrites[role] = discord.PermissionOverwrite(view_channel=True, send_messages=False)

    if is_index and cfg.get("index_staff_role"):
        role = interaction.guild.get_role(cfg["index_staff_role"])
        if role:
            overwrites[role] = PermissionOverwrite(view_channel=True, send_messages=True)

    try:
        channel = await category.create_text_channel(name, overwrites=overwrites)
    except Exception as e:
        await interaction.followup.send(f"Failed to create ticket: {str(e)}", ephemeral=True)
        return

    middleman_mention = f"<@&{cfg.get('middleman_role')}>" if cfg.get("middleman_role") else "@Middleman"

    await channel.send(
        f"{interaction.user.mention} {middleman_mention}",
        embed=discord.Embed(
            title="Ticket Opened",
            description="Staff will assist you shortly.\nPlease provide all details.",
            color=discord.Color.blue()
        )
    )

    details = discord.Embed(title="Ticket Details", color=discord.Color.blue())
    if is_index:
        details.add_field(name="What to index", value=modal.what_index.value, inline=False)
        details.add_field(name="Holding", value=modal.holding.value, inline=False)
        details.add_field(name="Obey rules", value=modal.obey_rules.value, inline=False)
    else:
        details.add_field(name="Other person", value=modal.other_user.value, inline=False)
        details.add_field(name="Details", value=modal.details.value, inline=False)
        details.add_field(name="PS links", value=modal.ps_join.value or "Not provided", inline=False)

    await channel.send(embed=details, view=TicketControlView(bot, config_data))

    await interaction.followup.send(f"**Ticket created!** → {channel.mention}", ephemeral=True)


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
    embed.set_image(url="https://i.ibb.co/JF73d5JF/ezgif-4b693c75629087.gif")
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
    embed.set_image(url="https://i.ibb.co/JF73d5JF/ezgif-4b693c75629087.gif")
    embed.set_footer(text="Indexing Service")

    await ctx.send(embed=embed, view=IndexRequestView(bot, config_data))


# =====================================================
# Run bot
# =====================================================
if __name__ == "__main__":
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        print("ERROR: DISCORD_TOKEN not set in environment variables")
        exit(1)

    print("Starting bot...")
    bot.run(token)
