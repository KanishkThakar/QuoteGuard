import hashlib, json, time
from decimal import Decimal
from django.conf import settings
from django.db import transaction
from . import cache
from .models import Quote, AuditEvent
from .pricing import calculate, scenarios, VERSION, D
from .rates import lookup, key as rate_key


class CalculationConflict(ValueError):
    """The source changed while a calculation was in flight."""


def inputs(q):
    return {
        "costs": list(q.costs.values("description", "quantity", "unit_cost")),
        "margin": q.target_margin,
        "fee": q.fee_percent,
        "fixed": q.fixed_fee,
        "currency": q.currency,
        "proposed": q.proposed_price,
    }


def changed(q, cause):
    transaction.on_commit(
        lambda: AuditEvent.objects.create(
            owner_id=q.owner_id, quote_id=q.id, cause=cause
        )
    )


def calculation_key(q, v, data, rate):
    normalized = {
        **data,
        "costs": [
            {
                **c,
                "quantity": str(D(c["quantity"]).normalize()),
                "unit_cost": str(D(c["unit_cost"]).normalize()),
            }
            for c in data["costs"]
        ],
    }
    for field in ["margin", "fee", "fixed", "proposed"]:
        normalized[field] = (
            str(D(data[field]).normalize()) if data[field] is not None else None
        )
    digest = hashlib.sha256(json.dumps(normalized, sort_keys=True).encode()).hexdigest()
    return f"qg:calc:{q.owner_id}:{q.id}:{v}:{rate['version']}:{VERSION}:{digest}"


def evaluate(q, refresh=False):
    if q.status == "finalised":
        return {**q.snapshot, "calculation_cache": "snapshot"}
    if q.status != "draft":
        raise ValueError(
            "Archived versions cannot be recalculated. Create a draft revision."
        )
    start = time.perf_counter()
    v = q.version
    data = inputs(q)
    rate = lookup(q.home_currency, q.currency, q.rate_date, refresh, owner=q.owner_id)
    if refresh:
        AuditEvent.objects.create(
            owner_id=q.owner_id,
            quote=q,
            cause="Rate refresh: dependent draft keys changed",
        )
    calculation_start = time.perf_counter()
    k = calculation_key(q, v, data, rate)
    result = cache.get(k)
    if result is not None and (
        result.get("calculation_version") != VERSION
        or result.get("currency") != q.currency
        or not {"gross_price", "cost", "margin", "profit", "scenarios"}.issubset(result)
    ):
        result = None
    hit = bool(result)
    if result is None:
        result = calculate(**data, rate=rate["rate"])
        result["scenarios"] = scenarios(
            data["costs"],
            data["margin"],
            data["fee"],
            data["fixed"],
            rate["rate"],
            q.currency,
            result["gross_price"],
        )
        # Adopt a suggested price once. Later cost/rate changes review the same draft
        # price instead of silently increasing the client's proposed amount.
        if q.proposed_price is None:
            with transaction.atomic():
                adopted = Quote.objects.filter(
                    id=q.id, version=v, status="draft", proposed_price__isnull=True
                ).update(proposed_price=result["gross_price"], version=v + 1)
                if adopted:
                    q.proposed_price = Decimal(result["gross_price"])
                    q.version = v + 1
                    v = q.version
                    data["proposed"] = q.proposed_price
                    changed(q, "Suggested price adopted: draft input version advanced")
            k = calculation_key(q, v, data, rate)
        if Quote.objects.filter(id=q.id, version=v, status="draft").exists():
            cache.set_value(k, result, settings.CALC_TTL)
    calculation_duration = (time.perf_counter() - calculation_start) * 1000
    cache.metric(
        q.owner_id,
        "calculation_hit" if hit else "calculation_miss",
        calculation_duration,
    )
    prior = q.last_calculation
    result = {
        **result,
        "rate_provenance": rate,
        "calculation_cache": "hit" if hit else "miss",
        "calculation_ttl": cache.ttl(k),
        "duration_ms": (time.perf_counter() - start) * 1000,
        "input_version": v,
        "calculation_duration_ms": calculation_duration,
    }
    if prior:
        result["change"] = {
            "old_margin": prior.get("margin"),
            "new_margin": result["margin"],
            "old_rate": prior.get("rate"),
            "new_rate": result["rate"],
            "old_profit": prior.get("profit"),
            "new_profit": result["profit"],
        }
    # A newer rate must not be presented as though this result used it.
    # Missing Redis data (expiry/outage) is not proof that the source changed.
    if rate["version"] != "identity":
        current_rate = cache.get(rate_key(q.home_currency, q.currency, q.rate_date))
        if current_rate and current_rate.get("version") != rate["version"]:
            raise CalculationConflict("Reference rate changed during calculation. Please retry.")
    saved = Quote.objects.filter(id=q.id, version=v, status="draft").update(
        last_calculation=result
    )
    if not saved:
        raise CalculationConflict("Draft changed during calculation. Please retry.")
    return result
