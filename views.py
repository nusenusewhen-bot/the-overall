# views.py
import discord
from discord.ui import View, Button, Select, Modal, TextInput
from discord import ButtonStyle, SelectOption

class TicketActionView(View):
    """Persistent view for claim/unclaim/close in ticket channels"""
    def __init__(self, claimed_by=None):
        super().__init__(timeout=None)  # persistent = no timeout
        self.claimed_by = claimed_by

        self.claim_button = Button(
            label="Claim",
            style=ButtonStyle.green,
            custom_id="claim_ticket",
            disabled=bool(claimed_by)
        )
        self.unclaim_button = Button(
            label="Unclaim",
            style=ButtonStyle.red,
            custom_id="unclaim_ticket",
            disabled=not claimed_by
        )
        self.close_button = Button(
            label="Close",
            style=ButtonStyle.gray,
            custom_id="close_ticket"
        )

        self.add_item(self.claim_button)
        self.add_item(self.unclaim_button)
        self.add_item(self.close_button)

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        # Optional: only allow certain roles to interact
        return True  # or add role check here

class MiddlemanRecruitView(View):
    """View for $earn - Join Us / Not Interested"""
    def __init__(self):
        super().__init__(timeout=None)  # persistent

        self.add_item(Button(
            label="Join Us",
            style=ButtonStyle.primary,
            custom_id="join_hitter"
        ))
        self.add_item(Button(
            label="Not Interested",
            style=ButtonStyle.danger,
            custom_id="not_interested_hitter"
        ))

class MMInfoView(View):
    """View for $mminfo - Understood / Didn't Understand"""
    def __init__(self):
        super().__init__(timeout=None)

        self.add_item(Button(
            label="Understood",
            style=ButtonStyle.success,
            custom_id="understood_mm"
        ))
        self.add_item(Button(
            label="Didn't Understand",
            style=ButtonStyle.danger,
            custom_id="didnt_understand_mm"
        ))

class TicketRequestSelect(discord.ui.Select):
    """Select menu for $support - Report / Support"""
    def __init__(self):
        options = [
            SelectOption(label="Report", value="report", emoji="🛡️"),
            SelectOption(label="Support", value="support", emoji="🆘")
        ]
        super().__init__(
            placeholder="Select ticket type...",
            min_values=1,
            max_values=1,
            options=options,
            custom_id="support_ticket_select"
        )

    async def callback(self, interaction: discord.Interaction):
        value = self.values[0]
        if value == "report":
            modal = ReportModal()
        else:
            modal = SupportModal()
        await interaction.response.send_modal(modal)

class RequestTicketButton(View):
    """View for $ticket1 - Request button"""
    def __init__(self):
        super().__init__(timeout=None)
        self.add_item(Button(
            label="Request",
            style=ButtonStyle.primary,
            emoji="📩",
            custom_id="request_ticket"
        ))

# Example modals (add more as needed)
class ReportModal(Modal, title="Report Ticket"):
    who_report = TextInput(
        label="Who do you want to report?",
        style=discord.TextStyle.short,
        required=True
    )
    description = TextInput(
        label="Description",
        style=discord.TextStyle.paragraph,
        required=True
    )

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.send_message("Report submitted!", ephemeral=True)
        # Here you can create ticket channel, etc.

class SupportModal(Modal, title="Support Ticket"):
    help_with = TextInput(
        label="What do you need help with?",
        style=discord.TextStyle.short,
        required=True
    )
    description = TextInput(
        label="Description",
        style=discord.TextStyle.paragraph,
        required=True
    )

    async def on_submit(self, interaction: discord.Interaction):
        await interaction.response.send_message("Support request sent!", ephemeral=True)
        # Ticket creation logic here

# Add more views/modals/selects as you expand the bot
