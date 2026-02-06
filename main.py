import discord
from discord.ext import commands
import json
import os
import io
import asyncio
from datetime import datetime
from dotenv import load_dotenv

from views import RequestView, IndexRequestView, TicketControlView, RequestModal, IndexRequestModal

load_dotenv()

intents = discord.Intents.default()
intents.message_content = True
intents.members = True

bot = commands.Bot(command_prefix="$", intents=intents)

CONFIG_FILE = "config.json"

def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r") as f:
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
    with open(CONFIG_FILE, "w") as f:
        json.dump(data, f, indent=4)

config_data = load_config()

def is_ticket_staff(member: discord.Member, cfg: dict) -> bool:
    cfg = cfg["config"]
    roles = member.roles
    return (
        any(r.id == cfg["middleman_role"] for r in roles) or
        any(r.id == cfg["staff_role"] for r in roles) or
        member.id == cfg["index_staff_id"]
    )

async def create_ticket(interaction: discord.Interaction, modal, is_index: bool = False):
    category = interaction.guild.get_channel(config_data["config"]["ticket_category"])
    if not category:
        await interaction.followup.send("Ticket category not configured.", ephemeral=True)
        return

    name_prefix = "index-" if is_index else "trade-"
    ticket_name = f"{name_prefix}{interaction.user.name.lower().replace(' ', '-')}"

    overwrites = {
        interaction.guild.default_role: discord.PermissionOverwrite(view_channel=False),
        interaction.user: discord.PermissionOverwrite(view_channel=True, send_messages=True),
    }

    # Add staff permissions
    for key in ["middleman_role", "staff_role", "owner_role"]:
        rid = config_data["config"].get(key)
        if rid:
            role = interaction.guild.get_role(rid)
            if role:
                overwrites[role] = discord.PermissionOverwrite(view_channel=True, send_messages=False)

    # Add index staff user if single user
    if is_index and config_data["config"]["index_staff_id"]:
        try:
            staff = await interaction.guild.fetch_member(config_data["config"]["index_staff_id"])
            overwrites[staff] = discord.PermissionOverwrite(view_channel=True, send_messages=True)
        except:
            pass

    channel = await category.create_text_channel(ticket_name, overwrites=overwrites)

    # Welcome message
    staff_mention = f"<@{config_data['config']['index_staff_id']}>" if is_index else "@Middleman"
    welcome_text = f"Hello {interaction.user.mention}, thanks for opening a ticket!"
    if is_index:
        welcome_text += "\nPlease state your Roblox username and wait for staff."

    await channel.send(
        f"{interaction.user.mention} {staff_mention}",
        embed=discord.Embed(
            title="Welcome to your Ticket!",
            description=welcome_text,
            color=discord.Color.blue()
        )
    )

    # Details from modal
    details = discord.Embed(title="Ticket Details", color=discord.Color.blue())
    if is_index:
        details.add_field(name="What to index", value=modal.what_index.value, inline=False)
        details.add_field(name="Holding", value=modal.holding.value, inline=False)
        details.add_field(name="Obey rules", value=modal.obey_rules.value, inline=False)
    else:
        details.add_field(name="Other user/ID", value=modal.other_user.value, inline=False)
        details.add_field(name="Details", value=modal.details.value, inline=False)
        details.add_field(name="PS links", value=modal.ps_join.value or "Not provided", inline=False)

    view = TicketControlView(bot, config_data)
    await channel.send(embed=details, view=view)

    await interaction.followup.send(f"Ticket created: {channel.mention}", ephemeral=True)


async def close_ticket(source, channel: discord.TextChannel, cfg: dict, claimed_by, closed_by):
    transcript_id = cfg["config"].get("transcript_channel")
    transcript_channel = channel.guild.get_channel(transcript_id) if transcript_id else None

    if transcript_channel:
        lines = [
            "Ticket file",
            f"Created by: {channel.topic or 'Unknown'}",
            f"Claimed by: {claimed_by.mention if claimed_by else 'None'}",
            f"Closed by: {closed_by.mention}",
            "═" * 60,
            ""
        ]

        async for msg in channel.history(limit=1000, oldest_first=True):
            if msg.author.bot and not msg.content.strip():
                continue
            ts = msg.created_at.strftime("%Y-%m-%d %H:%M:%S")
            author = msg.author.display_name
            content = msg.clean_content or "[Embed/Attachment]"
            lines.append(f"[{ts}] {author}: {content}")

        content = "\n".join(lines).encode("utf-8")
        filename = f"{channel.name}-{int(channel.created_at.timestamp())}.txt"

        await transcript_channel.send(
            f"Ticket **{channel.name}** closed by {closed_by.mention}",
            file=discord.File(io.BytesIO(content), filename=filename)
        )

    if isinstance(source, Interaction):
        await source.followup.send("Closing ticket...")
    else:
        await source.send("Closing ticket...")

    await channel.delete()


@bot.event
async def on_ready():
    print(f"Logged in as {bot.user}")
    bot.add_view(RequestView(bot, config_data))
    bot.add_view(IndexRequestView(bot, config_data))
    bot.add_view(TicketControlView(bot, config_data))


@bot.command()
@commands.has_role(lambda: config_data["config"]["owner_role"])
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
@commands.has_role(lambda: config_data["config"]["owner_role"])
async def index(ctx):
    cfg = config_data["config"]
    index_mention = f"<@{cfg['index_staff_id']}>" if cfg["index_staff_id"] else "@Index Staff"

    embed = discord.Embed(
        title="Indexing Services",
        description=(
            f"• Open this ticket if you would like a Indexing service to help finish your index and complete your base.\n\n"
            f"• You're going to have to pay first before we let you start indexing.\n\n"
            f"**When opening a ticket:**\n"
            f"• Wait for a {index_mention} to answer your ticket.\n"
            "• Be nice and kind to the staff and be patient.\n"
            "• State your roblox username on the account you want to complete the index in.\n\n"
            "If not following so your ticket will be deleted and you will be timed out for 1 hour ♥️"
        ),
        color=discord.Color.blue()
    )
    embed.set_image(url="https://i.imgur.com/1pZ1q2J.png")
    embed.set_footer(text="Indexing Service")

    await ctx.send(embed=embed, view=IndexRequestView(bot, config_data))


@bot.command()
async def redeem(ctx, *, key: str):
    if key not in config_data["keys"]:
        await ctx.send("Invalid or already used key.", delete_after=12)
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
        "Reply with **1** or **2**"
    )


@bot.event
async def on_message(message):
    if message.author.bot:
        return

    uid = str(message.author.id)
    if uid in config_data["activated_users"]:
        state = config_data["activated_users"][uid]
        if state["mode"] is None:
            if message.content.strip() in ("1", "2"):
                mode = int(message.content.strip())
                state["mode"] = mode
                save_config(config_data)
                msg = "Middleman mode chosen. Say **$setuptick** to start!" if mode == 1 else "Ticket mode chosen. Say **$setuptick** to start!"
                await message.channel
