import discord
from discord import ui, TextStyle, Interaction, PermissionOverwrite

class RequestModal(ui.Modal, title="Trade Request"):
    other_user = ui.TextInput(label="User/ID of other person", required=True)
    details = ui.TextInput(label="Details", style=TextStyle.paragraph, required=True)
    ps_join = ui.TextInput(label="can both join ps links?", required=False)

    def __init__(self, bot, config):
        super().__init__()
        self.bot = bot
        self.config = config  # config_data is passed here

    async def on_submit(self, interaction: Interaction):
        try:
            await interaction.response.defer(ephemeral=True)
            await create_ticket(interaction, self, is_index=False)
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
            await create_ticket(interaction, self, is_index=True)
        except Exception as e:
            print(f"Index modal error: {e}")
            await interaction.followup.send(f"Error creating ticket: {str(e)}", ephemeral=True)


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
