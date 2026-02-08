# views.py - FIXED VERSION: self-contained, no external calls that fail

import discord
from discord import ui, TextStyle, Interaction, PermissionOverwrite

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
            await self._create_ticket(interaction, is_index=False)
        except Exception as e:
            print(f"Trade modal error: {e}")
            await interaction.followup.send(f"Error creating ticket: {str(e)}", ephemeral=True)


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
            await self._create_ticket(interaction, is_index=True)
        except Exception as e:
            print(f"Index modal error: {e}")
            await interaction.followup.send(f"Error creating ticket: {str(e)}", ephemeral=True)


    async def _create_ticket(self, interaction: Interaction, is_index: bool = False):
        cfg = self.config["config"]
        category = interaction.guild.get_channel(cfg["ticket_category"])

        if not category:
            await interaction.followup.send("Ticket category not set in config.", ephemeral=True)
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
            print(f"[SUCCESS] Ticket created: {channel.name}")
        except Exception as e:
            print(f"[ERROR] Ticket creation failed: {str(e)}")
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
            details.add_field(name="What to index", value=self.what_index.value, inline=False)
            details.add_field(name="Holding", value=self.holding.value, inline=False)
            details.add_field(name="Obey rules", value=self.obey_rules.value, inline=False)
        else:
            details.add_field(name="Other person", value=self.other_user.value, inline=False)
            details.add_field(name="Details", value=self.details.value, inline=False)
            details.add_field(name="PS links", value=self.ps_join.value or "Not provided", inline=False)

        await channel.send(embed=details)

        await interaction.followup.send(f"**Ticket created!** → {channel.mention}", ephemeral=True)


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
