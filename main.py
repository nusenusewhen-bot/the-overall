import discord
from discord.ext import commands
import json
import os
import io
from datetime import datetime
from dotenv import load_dotenv

# Import your views (assuming views.py is in the same folder)
from views import (
    RequestView,
    IndexRequestView,
    TicketControlView,
    RequestModal,
    IndexRequestModal
)

# Load environment variables from .env file
load_dotenv()

# Bot setup
intents = discord.Intents.default()
intents.message_content = True
intents.members = True

bot = commands.Bot(command_prefix="$", intents=intents)

# Config file path
CONFIG_FILE = "config.json"


def load_config():
    """Load config.json or create default if it doesn't exist"""
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    
    # Default structure
    default_config = {
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
    save_config(default_config)
    return default_config


def save_config(data):
    """Save config to file"""
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)


# Load config once at startup
config_data = load_config()


def is_ticket_staff(member: discord.Member) -> bool:
    """Check if user has staff/middleman/index permissions"""
    cfg = config_data["config"]
    roles = [role.id for role in member.roles]
    return (
        cfg["middleman_role"] in roles or
        cfg["staff_role"] in roles or
        member.id == cfg["index_staff_id"]
    )


# =====================================================
# Ticket creation logic (used by both trade & index modals)
# =====================================================
async def create_ticket(interaction: discord.Interaction, modal, is_index: bool = False):
    cfg = config_data["config"]
    category = interaction.guild.get_channel(cfg["ticket_category"])
    
    if not category:
        await interaction.followup.send("Ticket category not configured.", ephemeral=True)
        return

    prefix = "index-" if is_index else "trade-"
    ticket_name = f"{prefix}{interaction.user.name.lower().replace(' ', '-')}"

    overwrites = {
        interaction.guild.default_role: discord.PermissionOverwrite(view_channel=False),
        interaction.user: discord.PermissionOverwrite(view_channel=True, send_messages=True),
    }

    # Add staff roles (view only)
    for key in ["middleman_role", "staff_role", "owner_role"]:
        rid = cfg.get(key)
        if rid:
            role = interaction.guild.get_role(rid)
            if role:
                overwrites[role] = discord.PermissionOverwrite(view_channel=True, send_messages=False)

    # Add index staff user (if single user & indexing ticket)
    if is_index and cfg["index_staff_id"]:
        try:
            staff_member = await interaction.guild.fetch_member(cfg["index_staff_id"])
            overwrites[staff_member] = discord.PermissionOverwrite(view_channel=True, send_messages=True)
        except:
            pass

    channel = await category.create_text_channel(ticket_name, overwrites=overwrites)

    # Welcome message
    staff_mention = f"<@{cfg['index_staff_id']}>" if is_index else "@Middleman"
    welcome_title = "Indexing Ticket Opened" if is_index else "Welcome to your Ticket!"
    welcome_desc = (
        f"Thanks for opening a ticket, {interaction.user.mention}!\n"
        f"Wait for {staff_mention} to assist you."
    )
    if is_index:
        welcome_desc += "\nPlease provide your Roblox username."

    await channel.send(
        f"{interaction.user.mention} {staff_mention}",
        embed=discord.Embed(
            title=welcome_title,
            description=welcome_desc,
            color=discord.Color.blue()
        )
    )

    # Details embed from modal
    details_embed = discord.Embed(title="Ticket Details", color=discord.Color.blue())
    
    if is_index:
        details_embed.add_field(name="What to index", value=modal.what_index.value, inline=False)
        details_embed.add_field(name="Holding", value=modal.holding.value, inline=False)
        details_embed.add_field(name="Obey rules", value=modal.obey_rules.value, inline=False)
    else:
        details_embed.add_field(name="Other user/ID", value=modal.other_user.value, inline=False)
        details_embed.add_field(name="Details", value=modal.details.value, inline=False)
        details_embed.add_field(name="PS links", value=modal.ps_join.value or "Not provided", inline=False)

    view = TicketControlView(bot, config_data)
    await channel.send(embed=details_embed, view=view)

    await interaction.followup.send(f"Ticket created → {channel.mention}", ephemeral=True)


# =====================================================
# Close ticket with transcript
# =====================================================
async def close_ticket(source, channel: discord.TextChannel, claimed_by=None, closed_by=None):
    cfg = config_data["config"]
    transcript_channel = channel.guild.get_channel(cfg["transcript_channel"])

    if transcript_channel:
        lines = [
            "Ticket file",
            f"Created by: Unknown (can be improved later)",
            f"Claimed by: {claimed_by.mention if claimed_by else 'None'}",
            f"Closed by: {closed_by.mention if closed_by else 'System'}",
            "═══════════════════════════════════════════════════════",
            ""
        ]

        async for msg in channel.history(limit=1000, oldest_first=True):
            if msg.author.bot and not msg.content.strip():
                continue
            ts = msg.created_at.strftime("%Y-%m-%d %H:%M:%S")
            author = msg.author.display_name
            content = msg.clean_content or "[Embed / Attachment]"
            lines.append(f"[{ts}] {author}: {content}")

        transcript_content = "\n".join(lines).encode("utf-8")
        filename = f"transcript-{channel.name}-{int(channel.created_at.timestamp())}.txt"

        await transcript_channel.send(
            content=f"Ticket **{channel.name}** closed by {closed_by.mention if closed_by else 'System'}",
            file=discord.File(io.BytesIO(transcript_content), filename=filename)
        )

    # Send closing message & delete channel
    if hasattr(source, "followup"):  # Interaction
        await source.followup.send("Closing ticket...")
    elif hasattr(source, "send"):     # Context (command)
        await source.send("Closing ticket...")

    await channel.delete()


# =====================================================
# Events
# =====================================================
@bot.event
async def on_ready():
    print(f"Logged in as {bot.user} ({bot.user.id})")
    print("------")
    
    # Register persistent views
    bot.add_view(RequestView(bot, config_data))
    bot.add_view(IndexRequestView(bot, config_data))
    bot.add_view(TicketControlView(bot, config_data))
    
    print("Persistent views added successfully")


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
                
                if mode == 1:
                    await message.channel.send("Middleman mode selected.\nSay **$setuptick** to start setup.")
                else:
                    await message.channel.send("Ticket-only mode selected.\nSay **$setuptick** to start setup.")
            else:
                await message.channel.send("Please reply with **1** or **2**.")

    await bot.process_commands(message)


# =====================================================
# Commands
# =====================================================
@bot.command()
@commands.check(lambda ctx: config_data["config"]["owner_role"] in [r.id for r in ctx.author.roles])
async def main(ctx):
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
@commands.check(lambda ctx: config_data["config"]["owner_role"] in [r.id for r in ctx.author.roles])
async def index(ctx):
    cfg = config_data["config"]
    staff_mention = f"<@{cfg['index_staff_id']}>" if cfg["index_staff_id"] else "@Index Staff"

    embed = discord.Embed(
        title="Indexing Services",
        description=(
            "• Open this ticket if you would like a Indexing service "
            "to help finish your index and complete your base.\n\n"
            "• You're going to have to pay first before we let you "
            "start indexing.\n\n"
            "**When opening a ticket:**\n"
            f"• Wait for a {staff_mention} to answer your ticket.\n"
            "• Be nice and kind to the staff and be patient.\n"
            "• State your roblox username on the account you "
            "want to complete the index in.\n\n"
            "If not following so your ticket will be deleted and you "
            "will be timed out for 1 hour ♥️"
        ),
        color=discord.Color.blue()
    )
    embed.set_image(url="https://i.imgur.com/1pZ1q2J.png")
    embed.set_footer(text="Indexing Service")

    await ctx.send(embed=embed, view=IndexRequestView(bot, config_data))


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
        "Choose Mode\n"
        "1 = Middleman\n"
        "2 = Ticket bot\n\n"
        "Reply with **1** or **2**"
    )


# =====================================================
# BOT LOGIN – at the bottom as requested
# =====================================================
if __name__ == "__main__":
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        print("ERROR: DISCORD_TOKEN not found in .env file")
        print("Please add it like this:")
        print("DISCORD_TOKEN=your.token.here")
        exit(1)

    print("Starting bot...")
    bot.run(token)
