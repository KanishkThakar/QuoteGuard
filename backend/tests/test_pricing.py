from decimal import Decimal
import pytest
from quotes.pricing import calculate, scenarios

costs = [{"quantity": "2", "unit_cost": "5000"}]


def test_formula_and_margin_not_markup():
    c = calculate(costs, ".25", "0", "0", ".01", "USD")
    assert c["suggested_price"] == "133.34"
    assert Decimal(c["margin"]) >= Decimal(".25")
    assert Decimal(c["profit"]) / Decimal(c["cost"]) > Decimal(".33")


def test_percentage_and_fixed_fees():
    c = calculate(costs, ".30", ".03", "2", ".01", "USD")
    assert c["suggested_price"] == "149.34"
    assert Decimal(c["margin"]) >= Decimal(".30")
    assert c["fees"] == "6.48"


@pytest.mark.parametrize("currency", ["USD", "JPY", "INR"])
def test_upward_rounding_never_undershoots(currency):
    c = calculate(
        [{"quantity": "1.001", "unit_cost": "7.125"}],
        ".333333",
        ".041",
        "1.231",
        ".01044",
        currency,
    )
    assert Decimal(c["margin"]) >= Decimal(".333333")
    assert (
        "." not in c["gross_price"]
        if currency == "JPY"
        else len(c["gross_price"].split(".")[1]) == 2
    )


@pytest.mark.parametrize(
    "m,f,F,r",
    [
        (1, 0, 0, 1),
        (0, 1, 0, 1),
        ("-.1", 0, 0, 1),
        (0, 0, -1, 1),
        (0, 0, 0, 0),
        ("NaN", 0, 0, 1),
        (0, "Infinity", 0, 1),
    ],
)
def test_invalid_inputs(m, f, F, r):
    with pytest.raises(ValueError):
        calculate(costs, m, f, F, r, "USD")


def test_zero_and_loss():
    zero = calculate([], 0, 0, 0, 1, "USD")
    assert zero["margin"] is None and zero["zero_revenue"]
    loss = calculate(costs, ".3", ".1", "5", ".01", "USD", 1)
    assert loss["negative_profit"] and loss["margin"] is None
    with pytest.raises(ValueError):
        calculate([{"quantity": -1, "unit_cost": 1}], 0, 0, 0, 1, "USD")
    with pytest.raises(ValueError):
        calculate(costs, 0, 0, 0, 1, "USD", -1)


def test_scenario_direction_fixed_price():
    rows = scenarios(costs, ".3", ".029", ".30", ".01044", "USD", "160")
    assert len({r["gross_price"] for r in rows}) == 1
    assert Decimal(rows[0]["profit"]) > Decimal(rows[-1]["profit"])


@pytest.mark.parametrize(
    "currency", ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "SGD", "INR"]
)
@pytest.mark.parametrize(
    "margin,fee,fixed",
    [("0", "0", "0"), (".9999", ".9999", "0.01"), (".3", ".03", "2")],
)
def test_supported_currencies_and_boundary_targets(currency, margin, fee, fixed):
    result = calculate(
        [{"quantity": "1", "unit_cost": "10"}], margin, fee, fixed, "1", currency
    )
    assert Decimal(result["margin"]) >= Decimal(margin)
    assert not result["negative_profit"]


@pytest.mark.parametrize("value", ["not-a-number", None, True, "-Infinity"])
def test_invalid_decimal_is_a_validation_error(value):
    with pytest.raises(ValueError):
        calculate(costs, value, 0, 0, 1, "USD")
