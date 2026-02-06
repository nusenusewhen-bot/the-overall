# views.py - FIXED: create_ticket is now inside this file

import discord
from discord import ui, TextStyle, Interaction, PermissionOverwrite

# Global config_data (imported from main.py or defined here if needed)
# If you have config_data in main.py, pass it or make it global. For simplicity, we'll assume it's passed or use a placeholder
# If you want to avoid global, pass config_data to views in on_ready (see below)

async def create_ticket(interaction: Interaction, modal, is_index: bool = False, config_data=None):
    if config_data is None:
        await interaction.followup.send("Config not loaded.", ephemeral=True)
        return

    cfg = config_data["config"]
    category = interaction.guild.get_channel(cfg["ticket_category"])

    if not category:
        await interaction.followup.send("Ticket category not set.", ephemeral=True)
        return

    prefix = "index-" if is_index else "trade-"
    name = f"{prefix}{interaction.user.name.lower().replace(' ', '-')[:20]}"

    overwrites = {
        interaction.guild.default_role: PermissionOverwrite(view_channel=False),
        interaction.user: PermissionOverwrite(view_channel=True, send_messages=True),
    }

    for key in ["middleman_role", "staff_role", "owner_role"]:
        rid = cfg.get(key)
        if rid:
            role = interaction.guild.get_role(rid)
            if role:
                overwrites[role] = PermissionOverwrite(view_channel=True, send_messages=False)

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


class RequestModal(ui.Modal, title="Trade Request"):
    other_user = ui.TextInput(label="User/ID of other person", required=True)
    details = ui.TextInput(label="Details", style=TextStyle.paragraph, required=True)
    ps_join = ui.TextInput(label="can both join ps links?", required=False)

    def __init__(self, bot, config):
        super().__init__()
        self.bot = bot
        self.config = config

    async def on_submit(self, interaction: Interaction):
        try:
            await interaction.response.defer(ephemeral=True)
            await create_ticket(interaction, self, is_index=False, config_data=config_data)  # pass config_data
        except Exception as e:
            print(f"Trade modal error: {e}")
            await interaction.followup.send(f"Error: {e}", ephemeral=True)


class IndexRequestModal(ui.Modal, title="Request Index"):
    what_index = ui.TextInput(label="What do you wanna index?", required=True)
    holding = ui.TextInput(label="What are you letting us hold?", required=True)
    obey_rules = ui.TextInput(label="Will you obey the staff rules?", required=True)

    def __init__(self, bot, config):
        super().__init__()
        self.bot = bot
        self.config = config

    async def on_submit(self, interaction: Interaction):
        try:
            await interaction.response.defer(ephemeral=True)
            await create_ticket(interaction, self, is_index=True, config_data=config_data)
        except Exception as e:
            print(f"Index modal error: {e}")
            await interaction.followup.send(f"Error: {e}", ephemeral=True)


class RequestView(ui.View):
    def __init__(self, bot, config):
        super().__init__(timeout=None)
        self.bot = bot
        self.config = config

    @ui.button(label="Request", style=discord.ButtonStyle.blurple, emoji="✉️", custom_id="trade_request")
    async def request(self, interaction: Interaction, button: ui.Button):
        await interaction.response.send_modal(RequestModal(self.bot, self.config))


class IndexRequestView(ui.View):
    def __init__(self, bot, config):
        super().__init__(timeout=None)
        self.bot = bot
        self.config = config

    @ui.button(label="Request Index", style=discord.ButtonStyle.blurple, emoji="✉️", custom_id="index_request")
    async def request_index(self, interaction: Interaction, button: ui.Button):
        await interaction.response.send_modal(IndexRequestModal(self.bot, self.config))


class TicketControlView(ui.View):
    def __init__(self, bot, config, claimed_by=None):
        super().__init__(timeout=None)
        self.bot = bot
        self.config = config
        self.claimed_by = claimed_by

        self.claim_btn = ui.Button(label="Claim", style=discord.ButtonStyle.green, emoji="✅", disabled=bool(claimed_by), custom_id="ticket_claim")
        self.unclaim_btn = ui.Button(label="Unclaim", style=discord.ButtonStyle.grey, emoji="🔓", disabled=not claimed_by, custom_id="ticket_unclaim")
        self.close_btn = ui.Button(label="Close", style=discord.ButtonStyle.red, emoji="✖️", custom_id="ticket_close")

        self.add_item(self.claim_btn)
        self.add_item(self.unclaim_btn)
        self.add_item(self.close_btn)

    @ui.button(label="Claim", style=discord.ButtonStyle.green, emoji="✅", custom_id="ticket_claim")
    async def claim(self, interaction: Interaction, button: ui.Button):
        if self.claimed_by:
            await interaction.response.send_message("Already claimed.", ephemeral=True)
            return

        if not is_ticket_staff(interaction.user):
            await interaction.response.send_message("Only staff can claim.", ephemeral=True)
            return

        self.claimed_by = interaction.user
        self.claim_btn.disabled = True
        self.unclaim_btn.disabled = False

        await interaction.channel.set_permissions(interaction.guild.default_role, send_messages=False)
        await interaction.channel.set_permissions(interaction.user, send_messages=True)

        await interaction.message.edit(view=self)
        await interaction.response.send_message(f"**Claimed by {interaction.user.mention}**")


    @ui.button(label="Unclaim", style=discord.ButtonStyle.grey, emoji="🔓", custom_id="ticket_unclaim")
    async def unclaim(self, interaction: Interaction, button: ui.Button):
        if interaction.user != self.claimed_by:
            await interaction.response.send_message("Only claimer can unclaim.", ephemeral=True)
            return

        self.claimed_by = None
        self.claim_btn.disabled = False
        self.unclaim_btn.disabled = True

        await interaction.channel.set_permissions(interaction.guild.default_role, send_messages=None)

        await interaction.message.edit(view=self)
        await interaction.response.send_message("Ticket unclaimed.")


    @ui.button(label="Close", style=discord.ButtonStyle.red, emoji="✖️", custom_id="ticket_close")
    async def close(self, interaction: Interaction, button: ui.Button):
        await interaction.response.send_message("Closing ticket...")
        await interaction.channel.delete()
