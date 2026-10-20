from decimal import (
    Decimal,
    ROUND_CEILING,
    ROUND_HALF_UP,
    localcontext,
    InvalidOperation,
)

VERSION = "decimal-v1"
MINOR = {
    "INR": 2,
    "USD": 2,
    "EUR": 2,
    "GBP": 2,
    "CAD": 2,
    "AUD": 2,
    "JPY": 0,
    "CHF": 2,
    "SGD": 2,
}


def D(value):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError("Enter a valid decimal amount.") from exc
    if not result.is_finite():
        raise ValueError("Amounts must be finite.")
    return result


def calculate(costs, margin, fee, fixed, rate, currency, proposed=None):
    with localcontext() as ctx:
        ctx.prec = 40
        m, f, F, r = map(D, (margin, fee, fixed, rate))
        if not 0 <= m < 1 or not 0 <= f < 1:
            raise ValueError(
                "Margin and percentage fee must be between 0 and 1, excluding 1."
            )
        if F < 0 or r <= 0:
            raise ValueError("Fixed fee must be nonnegative and rate positive.")
        if currency not in MINOR:
            raise ValueError("Unsupported currency.")
        C = Decimal(0)
        for item in costs:
            q, u = D(item["quantity"]), D(item["unit_cost"])
            if q < 0 or u < 0:
                raise ValueError("Costs and quantities must be nonnegative.")
            C += q * u
        quantum = Decimal(1).scaleb(-MINOR[currency])
        suggested = ((r * C / (1 - m) + F) / (1 - f)).quantize(
            quantum, rounding=ROUND_CEILING
        )
        B = (
            suggested
            if proposed is None
            else D(proposed).quantize(quantum, rounding=ROUND_HALF_UP)
        )
        if B > Decimal("999999999999.9999"):
            raise ValueError(
                "The quotation exceeds the supported maximum price. Reduce costs or fees."
            )
        if B < 0:
            raise ValueError("Quotation price must be nonnegative.")
        N = (B * (1 - f) - F) / r
        P = N - C
        actual = P / N if N > 0 else None

        def money(v):
            return str(v.quantize(Decimal(".01"), rounding=ROUND_HALF_UP))

        return {
            "calculation_version": VERSION,
            "cost": money(C),
            "suggested_price": str(suggested),
            "gross_price": str(B),
            "fees": str((B * f + F).quantize(quantum, rounding=ROUND_HALF_UP)),
            "net_revenue": money(N),
            "profit": money(P),
            "margin": str(actual) if actual is not None else None,
            "target_margin": str(m),
            "needs_review": actual is None or actual < m,
            "zero_revenue": N == 0,
            "negative_profit": P < 0,
            "currency": currency,
            "home_currency": "INR",
            "rate": str(r),
        }


def scenarios(
    costs, margin, fee, fixed, rate, currency, price, changes=(-5, -2, 0, 2, 5)
):
    return [
        {
            "change_percent": x,
            **calculate(
                costs, margin, fee, fixed, D(rate) * (1 + D(x) / 100), currency, price
            ),
        }
        for x in changes
    ]
