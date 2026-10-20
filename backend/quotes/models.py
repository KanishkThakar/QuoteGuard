from django.db import models
from django.conf import settings
from django.db.models import Q


class Client(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    name = models.CharField(max_length=160)
    company = models.CharField(max_length=160, blank=True)
    email = models.EmailField(blank=True)
    currency = models.CharField(max_length=3, default="USD")


class Quote(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    client = models.ForeignKey(Client, on_delete=models.PROTECT)
    title = models.CharField(max_length=180)
    description = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    valid_until = models.DateField()
    currency = models.CharField(max_length=3, default="USD")
    home_currency = models.CharField(max_length=3, default="INR")
    target_margin = models.DecimalField(max_digits=8, decimal_places=6, default="0.30")
    fee_percent = models.DecimalField(max_digits=8, decimal_places=6, default="0.029")
    fixed_fee = models.DecimalField(max_digits=16, decimal_places=4, default="0.30")
    proposed_price = models.DecimalField(
        max_digits=16, decimal_places=4, null=True, blank=True
    )
    rate_date = models.DateField(null=True, blank=True)
    status = models.CharField(
        max_length=12,
        default="draft",
        choices=[
            ("draft", "Draft"),
            ("finalised", "Finalised"),
            ("archived", "Archived"),
        ],
    )
    revision = models.PositiveIntegerField(default=1)
    version = models.PositiveIntegerField(default=1)
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="revisions",
    )
    snapshot = models.JSONField(null=True, blank=True)
    last_calculation = models.JSONField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-updated_at"]
        constraints = [
            models.CheckConstraint(
                condition=Q(target_margin__gte=0, target_margin__lt=1),
                name="valid_margin",
            ),
            models.CheckConstraint(
                condition=Q(fee_percent__gte=0, fee_percent__lt=1), name="valid_fee"
            ),
            models.CheckConstraint(
                condition=Q(fixed_fee__gte=0), name="fixed_fee_positive"
            ),
            models.CheckConstraint(
                condition=Q(proposed_price__gte=0) | Q(proposed_price__isnull=True),
                name="price_positive",
            ),
        ]


class CostItem(models.Model):
    quote = models.ForeignKey(Quote, on_delete=models.CASCADE, related_name="costs")
    description = models.CharField(max_length=180)
    quantity = models.DecimalField(max_digits=12, decimal_places=3)
    unit_cost = models.DecimalField(max_digits=16, decimal_places=4)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(quantity__gte=0), name="quantity_positive"
            ),
            models.CheckConstraint(condition=Q(unit_cost__gte=0), name="cost_positive"),
        ]


class RateSnapshot(models.Model):
    pair = models.CharField(max_length=20)
    requested_date = models.CharField(max_length=10)
    data = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)


class AuditEvent(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    quote = models.ForeignKey(Quote, null=True, on_delete=models.SET_NULL)
    cause = models.CharField(max_length=120)
    created_at = models.DateTimeField(auto_now_add=True)
