"""Read-only negotiation scenarios using the quotation's recorded rate."""

from decimal import Decimal, ROUND_FLOOR, localcontext
from .pricing import calculate, D, MINOR


def stress(
    data, baseline, discount_percent, cost_increase_percent, rate_change_percent
):
    with localcontext() as ctx:
        ctx.prec = 40
        discount, increase, change = map(
            D, (discount_percent, cost_increase_percent, rate_change_percent)
        )
        rate = D(baseline["rate"]) * (1 + change / 100)
        costs = [
            {**row, "unit_cost": D(row["unit_cost"]) * (1 + increase / 100)}
            for row in data["costs"]
        ]
        price = D(baseline["gross_price"]) * (1 - discount / 100)
        result = calculate(**{**data, "costs": costs, "proposed": price}, rate=rate)
        cost = sum(D(row["quantity"]) * D(row["unit_cost"]) for row in costs)
        net_billing = D(result["gross_price"]) * (1 - D(data["fee"])) - D(data["fixed"])
        net = net_billing / rate
        # Compare finite products before division: a repeating INR revenue must
        # not turn exact equality at the margin boundary into a false warning.
        meets_target = net_billing * (1 - D(data["margin"])) >= cost * rate
        budget = max(Decimal(0), net_billing * (1 - D(data["margin"])) / rate)
        quantum = Decimal(1).scaleb(-MINOR[data["currency"]])
        minimum = D(result["suggested_price"])
        original = D(baseline["gross_price"])
        max_discount = (
            max(Decimal(0), (1 - minimum / original) * 100) if original else Decimal(0)
        )
        return {
            **result,
            "hypothetical": True,
            "needs_review": net_billing <= 0 or not meets_target,
            "status": "loss"
            if net_billing <= 0 or net_billing < cost * rate
            else "below_target"
            if not meets_target
            else "protected",
            "minimum_price": str(minimum),
            "price_increase_needed": str(
                max(Decimal(0), minimum - D(result["gross_price"])).quantize(quantum)
            ),
            "cost_option_available": net > 0,
            "maximum_cost_budget": str(
                budget.quantize(Decimal(".01"), rounding=ROUND_FLOOR)
            ),
            "cost_reduction_needed": str(
                max(Decimal(0), cost - budget).quantize(
                    Decimal(".01"), rounding="ROUND_CEILING"
                )
            ),
            "maximum_discount_percent": str(
                max_discount.quantize(Decimal(".01"), rounding=ROUND_FLOOR)
            ),
            "baseline_price": baseline["gross_price"],
            "baseline_profit": baseline["profit"],
            "baseline_rate": baseline["rate"],
        }
