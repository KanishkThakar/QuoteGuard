from datetime import date, timedelta
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from quotes.models import Client, Quote, CostItem


class Command(BaseCommand):
    help = "Create clearly synthetic local demo accounts and business records."

    def handle(self, *args, **kwargs):
        u, created = get_user_model().objects.get_or_create(username="demo")
        if created:
            u.set_password("DemoQuoteGuard!2026")
            u.save()
        other, created = get_user_model().objects.get_or_create(username="demo_other")
        if created:
            other.set_password("DemoQuoteGuard!2026")
            other.save()
        for name, company, currency, title, cost in [
            (
                "Alex Morgan",
                "Northstar Studio (synthetic)",
                "USD",
                "Brand identity & launch website",
                "65000",
            ),
            (
                "Sophie Ellis",
                "Fieldwork Co. (synthetic)",
                "GBP",
                "Editorial design system",
                "42000",
            ),
            (
                "Luca Rossi",
                "Forma Atelier (synthetic)",
                "EUR",
                "E-commerce experience",
                "88000",
            ),
        ]:
            client, _ = Client.objects.get_or_create(
                owner=u,
                name=name,
                defaults={
                    "company": company,
                    "email": "demo@example.com",
                    "currency": currency,
                },
            )
            if not Quote.objects.filter(owner=u, title=title).exists():
                q = Quote.objects.create(
                    owner=u,
                    client=client,
                    title=title,
                    currency=currency,
                    valid_until=date.today() + timedelta(days=30),
                    description="Synthetic demonstration project. Strategy, design and implementation.",
                    notes="50% on acceptance; remaining balance at handover. Demo terms only.",
                )
                CostItem.objects.create(
                    quote=q,
                    description="Design & development",
                    quantity=1,
                    unit_cost=cost,
                )
        self.stdout.write(
            "LOCAL SYNTHETIC DEMO: demo / DemoQuoteGuard!2026 (and demo_other). No real client records."
        )
