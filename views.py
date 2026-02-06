import discord
from discord import ui, Interaction, TextStyle
import io

class RequestModal(ui.Modal, title="Trade Request"):
    other_user = ui.TextInput(label="User/ID of other person", required=True, max_length=100)
    details = ui.TextInput(label="Details", style=TextStyle.paragraph, required=True, max_length=1000)
    ps_join = ui.TextInput(label="can both join ps links?", required=False, max_length=200)

    async def on_submit(self, interaction: Interaction):
        await interaction.response.defer(ephemeral=True)
        # ticket creation logic is in main.py → create_ticket function
        await create_ticket(interaction, self, is_index=False)


class IndexRequestModal(ui.Modal, title="Request Indexing Service"):
    what_index = ui.TextInput(label="What do you wanna index?", required=True, max_length=200)
    holding = ui.TextInput(label="What are you letting us hold?", required=True, max_length=200)
    obey_rules = ui.TextInput(label="Will you obey the staff rules?", required=True, max_length=200)

    async def on_submit(self, interaction: Interaction):
        await interaction.response.defer(ephemeral=True)
        await create_ticket(interaction, self, is_index=True)


class RequestView(ui.View):
    def __init__(self, bot, config):
        super().__init__(timeout=None)
        self.bot = bot
        self.config = config

    @ui.button(label="Request", style=discord.ButtonStyle.blurple, emoji="✉️", custom_id="persistent:request_trade")
    async def request(self, interaction: Interaction, button: ui.Button):
        await interaction.response.send_modal(RequestModal())


class IndexRequestView(ui.View):
    def __init__(self, bot, config):
        super().__init__(timeout=None)
        self.bot = bot
        self.config = config

    @ui.button(label="Request Index", style=discord.ButtonStyle.blurple, emoji="✉️", custom_id="persistent:request_index")
    async def request_index(self, interaction: Interaction, button: ui.Button):
        await interaction.response.send_modal(IndexRequestModal())


class TicketControlView(ui.View):
    def __init__(self, bot, config, claimed_by=None):
        super().__init__(timeout=None)
        self.bot = bot
        self.config = config
        self.claimed_by = claimed_by

        claim_btn = discord.ui.Button(label="Claim Ticket", style=discord.ButtonStyle.green, emoji="✅", custom_id="ticket:claim")
        unclaim_btn = discord.ui.Button(label="Unclaim Ticket", style=discord.ButtonStyle.grey, emoji="🔓", custom_id="ticket:unclaim", disabled=claimed_by is not None)
        close_btn = discord.ui.Button(label="Close Ticket", style=discord.ButtonStyle.red, emoji="✖", custom_id="ticket:close")
        timeout_btn = discord.ui.Button(label="Timeout & Close", style=discord.ButtonStyle.danger, emoji="⏰✖", custom_id="ticket:timeoutclose")

        self.add_item(claim_btn)
        self.add_item(unclaim_btn)
        self.add_item(close_btn)
        self.add_item(timeout_btn)

    @ui.button(custom_id="ticket:claim")
    async def claim(self, interaction: Interaction, button: discord.ui.Button):
        if not is_ticket_staff(interaction.user, self.config):
            await interaction.response.send_message("Only staff can claim.", ephemeral=True)
            return

        self.claimed_by = interaction.user
        button.disabled = True
        self.children[1].disabled = False  # unclaim

        await interaction.channel.set_permissions(interaction.guild.default_role, send_messages=False)
        await interaction.channel.set_permissions(interaction.user, send_messages=True)

        await interaction.message.edit(view=self)
        await interaction.response.send_message(f"**Claimed by {interaction.user.mention}**")

    @ui.button(custom_id="ticket:unclaim")
    async def unclaim(self, interaction: Interaction, button: discord.ui.Button):
        if interaction.user != self.claimed_by:
            await interaction.response.send_message("Only the claimer can unclaim.", ephemeral=True)
            return

        self.claimed_by = None
        self.children[0].disabled = False
        button.disabled = True

        await interaction.channel.set_permissions(interaction.guild.default_role, send_messages=None)
        await interaction.message.edit(view=self)
        await interaction.response.send_message("Ticket unclaimed.")

    @ui.button(custom_id="ticket:close")
    async def close(self, interaction: Interaction, button: discord.ui.Button):
        await interaction.response.defer()
        await close_ticket(interaction, interaction.channel, self.config, self.claimed_by, interaction.user)

    @ui.button(custom_id="ticket:timeoutclose")
    async def timeout_close(self, interaction: Interaction, button: discord.ui.Button):
        await interaction.response.defer()
        target = None
        for target_obj, perms in interaction.channel.overwrites.items():
            if isinstance(target_obj, discord.Member) and perms.send_messages:
                target = target_obj
                break

        if target:
            try:
                until = discord.utils.utcnow() + discord.timedelta(hours=1)
                await target.timeout(until, reason="Violation - staff action")
                await interaction.channel.send(f"{target.mention} timed out 1h by {interaction.user.mention}")
            except:
                await interaction.channel.send("Could not timeout user (check permissions).")

        await close_ticket(interaction, interaction.channel, self.config, self.claimed_by, interaction.user)
