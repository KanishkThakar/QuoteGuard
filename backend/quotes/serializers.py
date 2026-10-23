from decimal import Decimal
from rest_framework import serializers
from .models import Client, Quote, CostItem
from .pricing import MINOR


class ClientSerializer(serializers.ModelSerializer):
    class Meta:
        model = Client
        fields = ["id", "name", "company", "email", "currency"]

    def validate_currency(self, value):
        if value not in MINOR:
            raise serializers.ValidationError("Unsupported currency.")
        return value


class CostSerializer(serializers.ModelSerializer):
    class Meta:
        model = CostItem
        fields = ["description", "quantity", "unit_cost"]

    def validate(self, data):
        if data["quantity"] < 0 or data["unit_cost"] < 0:
            raise serializers.ValidationError("Costs must be nonnegative.")
        return data


class QuoteSerializer(serializers.ModelSerializer):
    costs = CostSerializer(many=True)
    client_name = serializers.SerializerMethodField()
    client_details = serializers.SerializerMethodField()
    calculation_stale = serializers.SerializerMethodField()
    stale_reasons = serializers.SerializerMethodField()

    def get_client_name(self, obj):
        if obj.status == "finalised" and obj.snapshot:
            return obj.snapshot["quotation"]["client_name"]
        return obj.client.name

    def get_client_details(self, obj):
        if obj.status == "finalised" and obj.snapshot:
            return obj.snapshot["quotation"].get("client_details", {})
        return ClientSerializer(obj.client).data

    def freshness(self, obj):
        if obj.status != "draft" or not obj.last_calculation:
            return []
        previous = obj.last_calculation
        reasons = []
        if previous.get("input_version") != obj.version:
            reasons.append("inputs_changed")
        provenance = previous.get("rate_provenance", {})
        if provenance.get("version") != "identity":
            from . import cache
            from .rates import key
            from django.conf import settings
            from django.utils import timezone
            from datetime import datetime

            rate_key = key(obj.home_currency, obj.currency, obj.rate_date)
            heads = self.context.setdefault("rate_heads", {})
            if rate_key not in heads:
                heads[rate_key] = cache.get(rate_key)
            current = heads[rate_key]
            if current and current.get("version") != provenance.get("version"):
                reasons.append("rate_changed")
            elif not current:
                try:
                    age = (
                        timezone.now()
                        - datetime.fromisoformat(provenance["fetched_at"])
                    ).total_seconds()
                    ttl = (
                        settings.RATE_HISTORY_TTL
                        if obj.rate_date
                        else settings.RATE_LATEST_TTL
                    )
                    if age > ttl:
                        reasons.append("rate_needs_check")
                except (KeyError, ValueError, TypeError):
                    reasons.append("rate_needs_check")
        return reasons

    def get_calculation_stale(self, obj):
        return bool(self.freshness(obj))

    def get_stale_reasons(self, obj):
        return self.freshness(obj)

    def validate_costs(self, value):
        if len(value) > 200:
            raise serializers.ValidationError(
                "Use at most 200 cost items per quotation."
            )
        return value

    class Meta:
        model = Quote
        fields = [
            "id",
            "client",
            "client_name",
            "client_details",
            "calculation_stale",
            "stale_reasons",
            "title",
            "description",
            "notes",
            "valid_until",
            "currency",
            "home_currency",
            "target_margin",
            "fee_percent",
            "fixed_fee",
            "proposed_price",
            "rate_date",
            "status",
            "revision",
            "version",
            "parent",
            "snapshot",
            "last_calculation",
            "costs",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "status",
            "revision",
            "version",
            "parent",
            "snapshot",
            "last_calculation",
            "created_at",
            "updated_at",
        ]

    def validate_client(self, value):
        if value.owner_id != self.context["request"].user.id:
            raise serializers.ValidationError("Client unavailable.")
        return value

    def validate(self, data):
        for field in ["target_margin", "fee_percent"]:
            if field in data and not 0 <= data[field] < 1:
                raise serializers.ValidationError(
                    {field: "Must be at least 0 and less than 1."}
                )
        for field in ["fixed_fee", "proposed_price"]:
            if data.get(field) is not None and data[field] < 0:
                raise serializers.ValidationError({field: "Must be nonnegative."})
        if (
            data.get("currency", self.instance.currency if self.instance else "USD")
            not in MINOR
        ):
            raise serializers.ValidationError({"currency": "Unsupported currency."})
        if data.get("home_currency", "INR") != "INR":
            raise serializers.ValidationError(
                {"home_currency": "Home currency is INR in this version."}
            )
        from datetime import date

        if data.get("rate_date") and data["rate_date"] > date.today():
            raise serializers.ValidationError({"rate_date": "Cannot be in the future."})
        return data

    def create(self, data):
        costs = data.pop("costs")
        quote = Quote.objects.create(**data)
        CostItem.objects.bulk_create([CostItem(quote=quote, **i) for i in costs])
        return quote

    def update(self, instance, data):
        costs = data.pop("costs", None)
        for k, v in data.items():
            setattr(instance, k, v)
        instance.version += 1
        instance.save()
        if costs is not None:
            instance.costs.all().delete()
            CostItem.objects.bulk_create([CostItem(quote=instance, **i) for i in costs])
        return instance


class CalculationRequestSerializer(serializers.Serializer):
    refresh = serializers.BooleanField(default=False)


class ScenarioRequestSerializer(serializers.Serializer):
    change_percent = serializers.DecimalField(
        max_digits=8, decimal_places=4, min_value=-99, max_value=100
    )


class LabRequestSerializer(serializers.Serializer):
    operation = serializers.ChoiceField(choices=["cold", "warm", "refresh", "expiry"])
    currency = serializers.ChoiceField(choices=list(MINOR), default="USD")
    start = serializers.BooleanField(default=False)


class PlanRequestSerializer(serializers.Serializer):
    target_margin = serializers.DecimalField(
        max_digits=6, decimal_places=4, min_value=0, max_value=Decimal("0.9999")
    )


class StressRequestSerializer(serializers.Serializer):
    discount_percent = serializers.DecimalField(
        max_digits=6, decimal_places=2, min_value=0, max_value=100, default=0
    )
    cost_increase_percent = serializers.DecimalField(
        max_digits=6, decimal_places=2, min_value=0, max_value=100, default=0
    )
    rate_change_percent = serializers.DecimalField(
        max_digits=6, decimal_places=2, min_value=-50, max_value=50, default=0
    )
