# views.py
import discord
from discord import ui, TextStyle, Interaction, PermissionOverwrite, CategoryChannel, Member

class RequestModal(ui.Modal, title="Trade Request"):
    other_user = ui.TextInput(
        label="User/ID of other person",
        placeholder="Username, @mention or ID",
        required=True,
        max_length=100
    )
    details = ui.TextInput(
        label="Details",
        style=TextStyle.paragraph,
        required=True,
        max_length=1000
    )
    ps_join = ui.TextInput(
        label="can both join ps links?",
        placeholder="yes / no / maybe",
        required=False,
        max_length=200
    )

    def __init__(self, bot, config):
        super().__init__()
        self.bot = bot
        self.config = config

    async def on_submit(self, interaction: Interaction):
        await interaction.response.defer(ephemeral=True)

        guild = interaction.guild
        cfg = self.config["config"]
        category = guild.get_channel(cfg["ticket_category"])

        if not isinstance(category, CategoryChannel):
            await interaction.followup.send("Ticket category is not set or invalid.", ephemeral=True)
            return

        # Generate ticket name
        ticket_name = f"trade-{interaction.user.name.lower().replace(' ', '-')[:20]}"

        # Basic overwrites
        overwrites = {
            guild.default_role: PermissionOverwrite(view_channel=False),
            interaction.user: PermissionOverwrite(view_channel=True, send_messages=True),
        }

        # Add staff roles (view only)
        for role_key in ["middleman_role", "staff_role", "owner_role"]:
            rid = cfg.get(role_key)
            if rid:
                role = guild.get_role(rid)
                if role:
                    overwrites[role] = PermissionOverwrite(view_channel=True, send_messages=False)

        # Create the channel
        try:
            channel = await category.create_text_channel(ticket_name, overwrites=overwrites)
        except Exception as e:
            await interaction.followup.send(f"Failed to create channel: {e}", ephemeral=True)
            return

        # Welcome message
        await channel.send(
            f"{interaction.user.mention} @Middleman",
            embed=discord.Embed(
                title="Welcome to your Trade Ticket!",
                description="A middleman/staff will assist you shortly.\nPlease provide all details clearly.",
                color=discord.Color.blue()
            )
        )

        # Details from modal
        details_embed = discord.Embed(title="Trade Details", color=discord.Color.blue())
        details_embed.add_field(name="Other person", value=self.other_user.value, inline=False)
        details_embed.add_field(name="Details", value=self.details.value, inline=False)
        details_embed.add_field(name="PS links", value=self.ps_join.value or "Not provided", inline=False)

        await channel.send(embed=details_embed)

        await interaction.followup.send(
            f"**Ticket created!** → {channel.mention}",
            ephemeral=True
        )


class IndexRequestModal(ui.Modal, title="Request Indexing"):
    what_index = ui.TextInput(label="What do you wanna index?", required=True)
    holding = ui.TextInput(label="What are you letting us hold?", required=True)
    obey_rules = ui.TextInput(label="Will you obey the staff rules?", required=True)

    def __init__(self, bot, config):
        super().__init__()
        self.bot = bot
        self.config = config

    async def on_submit(self, interaction: Interaction):
        await interaction.response.defer(ephemeral=True)

        guild = interaction.guild
        cfg = self.config["config"]
        category = guild.get_channel(cfg["ticket_category"])

        if not isinstance(category, CategoryChannel):
            await interaction.followup.send("Ticket category is not set or invalid.", ephemeral=True)
            return

        ticket_name = f"index-{interaction.user.name.lower().replace(' ', '-')[:20]}"

        overwrites = {
            guild.default_role: PermissionOverwrite(view_channel=False),
            interaction.user: PermissionOverwrite(view_channel=True, send_messages=True),
        }

        # Add staff roles
        for role_key in ["middleman_role", "staff_role", "owner_role"]:
            rid = cfg.get(role_key)
            if rid:
                role = guild.get_role(rid)
                if role:
                    overwrites[role] = PermissionOverwrite(view_channel=True, send_messages=False)

        # Add index staff role (ping role)
        if cfg.get("index_staff_role"):
            role = guild.get_role(cfg["index_staff_role"])
            if role:
                overwrites[role] = PermissionOverwrite(view_channel=True, send_messages=True)

        try:
            channel = await category.create_text_channel(ticket_name, overwrites=overwrites)
        except Exception as e:
            await interaction.followup.send(f"Failed to create channel: {e}", ephemeral=True)
            return

        await channel.send(
            f"{interaction.user.mention} <@&{cfg.get('index_staff_role', 'Index Staff')}>",
            embed=discord.Embed(
                title="Indexing Ticket Opened",
                description="Staff will assist soon.\nPlease provide your Roblox username.",
                color=discord.Color.blue()
            )
        )

        details = discord.Embed(title="Indexing Request", color=discord.Color.blue())
        details.add_field(name="What to index", value=self.what_index.value, inline=False)
        details.add_field(name="Holding", value=self.holding.value, inline=False)
        details.add_field(name="Obey rules", value=self.obey_rules.value, inline=False)

        await channel.send(embed=details)

        await interaction.followup.send(
            f"**Indexing ticket created!** → {channel.mention}",
            ephemeral=True
        )


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
