# views.py
import discord
from discord import ui, TextStyle, Interaction

class RequestModal(ui.Modal, title="Trade Request"):
    other_user = ui.TextInput(label="User/ID of other person", required=True)
    details = ui.TextInput(label="Details", style=TextStyle.paragraph, required=True)
    ps_join = ui.TextInput(label="can both join ps links?", required=False)

    def __init__(self, bot, config):
        super().__init__()
        self.bot = bot
        self.config = config

    async def on_submit(self, interaction: Interaction):
        await interaction.response.defer(ephemeral=True)
        await create_ticket(interaction, self, is_index=False)  # calls function in main.py


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

    @ui.button(label="Request", style=discord.ButtonStyle.blurple, emoji="✉️")
    async def request(self, interaction: Interaction, button: ui.Button):
        await interaction.response.send_modal(RequestModal(self.bot, self.config))


class IndexRequestView(ui.View):
    def __init__(self, bot, config):
        super().__init__(timeout=None)

    @ui.button(label="Request Index", style=discord.ButtonStyle.blurple, emoji="✉️")
    async def request_index(self, interaction: Interaction, button: ui.Button):
        await interaction.response.send_modal(IndexRequestModal(self.bot, self.config))
