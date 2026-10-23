from decimal import Decimal
from unittest.mock import patch
import pytest
from quotes.stress import stress
from quotes.pricing import calculate
from tests.test_integration import setup


def inputs():
    return dict(
        costs=[dict(quantity="1", unit_cost="65000")],
        margin=".25",
        fee=".03",
        fixed="2",
        currency="USD",
        proposed=None,
    )


@pytest.mark.parametrize(
    "discount,cost,fx", [(0, 0, 0), (15, 20, 10), (100, 100, -50), (0, 0, 50)]
)
def test_stress_recovery_price_meets_target(discount, cost, fx):
    data = inputs()
    base = calculate(**data, rate=".01")
    r = stress(data, base, discount, cost, fx)
    recovered = calculate(
        **{
            **data,
            "costs": [
                dict(quantity=1, unit_cost=Decimal(65000) * (1 + Decimal(cost) / 100))
            ],
            "proposed": r["minimum_price"],
        },
        rate=r["rate"],
    )
    assert Decimal(recovered["margin"]) >= Decimal(".25")
    assert Decimal(r["cost_reduction_needed"]) >= 0
    assert r["hypothetical"] is True
    assert base["gross_price"] == calculate(**data, rate=".01")["gross_price"]


def test_discount_and_fx_direction():
    data = inputs()
    base = calculate(**data, rate=".01")
    assert Decimal(stress(data, base, 10, 0, 0)["profit"]) < Decimal(base["profit"])
    assert Decimal(stress(data, base, 0, 0, 10)["profit"]) < Decimal(base["profit"])
    assert Decimal(stress(data, base, 0, 0, -10)["profit"]) > Decimal(base["profit"])


@pytest.mark.django_db(transaction=True)
def test_stress_endpoint_real_cache_owner_and_no_mutation(setup):
    u, other, c, q, api = setup
    url = f"/api/quotes/{q.id}/"
    assert api.post(url + "stress/", {}, format="json").status_code == 409
    assert api.post(url + "calculate/", {}, format="json").status_code == 200
    q.refresh_from_db()
    before = (q.version, q.last_calculation, q.snapshot, q.status)
    with patch(
        "quotes.rates.fetch",
        side_effect=AssertionError("Scenario must not call provider"),
    ):
        first = api.post(
            url + "stress/", {"discount_percent": "10"}, format="json"
        ).json()
        second = api.post(
            url + "stress/", {"discount_percent": "10"}, format="json"
        ).json()
    assert first["trace"]["decision"] == "miss"
    assert second["trace"]["decision"] == "hit"
    assert first["trace"]["cache_written"] is True
    assert first["trace"]["request_id"] != second["trace"]["request_id"]
    assert second["trace"]["provider_called"] is False
    assert second["trace"]["calculation_executed"] is False
    q.refresh_from_db()
    assert before == (q.version, q.last_calculation, q.snapshot, q.status)
    assert (
        api.post(
            url + "stress/", {"discount_percent": "101"}, format="json"
        ).status_code
        == 400
    )
    q.version += 1
    q.save(update_fields=["version"])
    assert api.post(url + "stress/", {}, format="json").status_code == 409
    api.force_authenticate(other)
    assert api.post(url + "stress/", {}, format="json").status_code == 404


@pytest.mark.django_db(transaction=True)
def test_finalised_preview_and_redis_outage(setup):
    *_, q, api = setup
    url = f"/api/quotes/{q.id}/"
    assert api.post(url + "finalise/", {}, format="json").status_code == 200
    q.refresh_from_db()
    snapshot = q.snapshot
    version = q.version
    with (
        patch("quotes.cache.get", return_value=None),
        patch("quotes.cache.set_value", return_value=False),
    ):
        response = api.post(url + "stress/", {"discount_percent": "100"}, format="json")
    assert response.status_code == 200
    assert response.json()["trace"]["cache_written"] is False
    assert response.json()["status"] == "loss"
    q.refresh_from_db()
    assert q.snapshot == snapshot and q.version == version


def test_exact_margin_boundary_avoids_repeating_division_warning():
    data = dict(
        costs=[dict(quantity="1", unit_cost="1000")],
        margin=".25",
        fee="0",
        fixed="0",
        currency="USD",
        proposed=None,
    )
    baseline = calculate(**data, rate=".01044")
    result = stress(data, baseline, 0, 0, 0)
    assert result["status"] == "protected"
    assert result["needs_review"] is False
    assert result["maximum_cost_budget"] == "1000.00"
    assert result["cost_reduction_needed"] == "0.00"
