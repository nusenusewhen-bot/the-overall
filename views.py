# views.py - FULL WORKING VERSION

import discord
from discord import ui, TextStyle, Interaction, PermissionOverwrite

class RequestModal(ui.Modal, title="Trade Request"):
    other_user = ui.TextInput(
        label="User/ID of other person",
        placeholder="Username or ID",
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
        placeholder="yes / no",
        required=False,
        max_length=200
    )

    def __init__(self, bot, config):
        super().__init__()
        self.bot = bot
        self.config = config

    async def on_submit(self, interaction: Interaction):
        await interaction.response.defer(ephemeral=True)
        await create_ticket(interaction, self, is_index=False)  # call function from main.py


class IndexRequestModal(ui.Modal, title="Request Index"):
    what_index = ui.TextInput(label="What do you wanna index?", required=True)
    holding = ui.TextInput(label="What are you letting us hold?", required=True)
    obey_rules = ui.TextInput(label="Will you obey the staff rules?", required=True)

    def __init__(self, bot, config):
        super().__init__()
        self.bot = bot
        self.config = config

    async def on_submit(self, interaction: Interaction):
        await interaction.response.defer(ephemeral=True)
        await create_ticket(interaction, self, is_index=True)


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

        # Buttons
        self.claim_btn = ui.Button(label="Claim", style=discord.ButtonStyle.green, emoji="✅", disabled=bool(claimed_by))
        self.unclaim_btn = ui.Button(label="Unclaim", style=discord.ButtonStyle.grey, emoji="🔓", disabled=not claimed_by)
        self.close_btn = ui.Button(label="Close", style=discord.ButtonStyle.red, emoji="✖️")

        self.add_item(self.claim_btn)
        self.add_item(self.unclaim_btn)
        self.add_item(self.close_btn)

    @ui.button(label="Claim", style=discord.ButtonStyle.green, emoji="✅")
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

        # Restrict typing
        await interaction.channel.set_permissions(interaction.guild.default_role, send_messages=False)
        await interaction.channel.set_permissions(interaction.user, send_messages=True)
        await interaction.channel.set_permissions(interaction.user, view_channel=True)

        await interaction.message.edit(view=self)
        await interaction.response.send_message(f"**Claimed by {interaction.user.mention}**")


    @ui.button(label="Unclaim", style=discord.ButtonStyle.grey, emoji="🔓")
    async def unclaim(self, interaction: Interaction, button: ui.Button):
        if interaction.user != self.claimed_by:
            await interaction.response.send_message("Only claimer can unclaim.", ephemeral=True)
            return

        self.claimed_by = None
        self.claim_btn.disabled = False
        self.unclaim_btn.disabled = True

        # Restore typing for staff/middleman roles
        await interaction.channel.set_permissions(interaction.guild.default_role, send_messages=None)

        await interaction.message.edit(view=self)
        await interaction.response.send_message("Ticket unclaimed.")


    @ui.button(label="Close", style=discord.ButtonStyle.red, emoji="✖️")
    async def close(self, interaction: Interaction, button: ui.Button):
        await interaction.response.send_message("Closing ticket...")
        await interaction.channel.delete()
