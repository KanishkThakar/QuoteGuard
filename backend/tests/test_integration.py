import io, json, time, uuid, threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch
import pytest, redis, requests
from django.contrib.auth import get_user_model
from django.db import transaction, close_old_connections
from django.test import Client as DjangoClient
from rest_framework.test import APIClient
from pypdf import PdfReader
from quotes import cache, rates
from quotes.models import Client, Quote, CostItem, RateSnapshot, AuditEvent
from quotes.services import evaluate, CalculationConflict
from quotes.rates import RateError

pytestmark = pytest.mark.django_db(transaction=True)


def fixture_rate(home="INR", billing="USD", requested=None):
    return {
        "rate": ".01044",
        "requested_date": str(requested or "latest"),
        "actual_date": "2026-10-09",
        "previous_available_date": bool(requested and str(requested) != "2026-10-09"),
        "source": "Controlled synthetic test fixture; not an empirical rate observation",
        "fetched_at": "2026-10-12T16:00:00+00:00",
        "response_sha256": "test-recorded",
        "response": "test",
        "version": uuid.uuid4().hex,
    }


@pytest.fixture
def setup(monkeypatch):
    cache.connection().ping()
    # Delete only this test's currency pair keys, never flush the Redis database.
    for pair in ["USD", "EUR", "GBP", "INR"]:
        cache.connection().delete(
            rates.key("INR", pair, None), rates.key("INR", pair, None) + ":lock"
        )
    monkeypatch.setattr(rates, "fetch", fixture_rate)
    u = get_user_model().objects.create_user("owner", password="OwnerPassword!2026")
    other = get_user_model().objects.create_user("other", password="OtherPassword!2026")
    c = Client.objects.create(owner=u, name="Synthetic Client", currency="USD")
    q = Quote.objects.create(
        owner=u,
        client=c,
        title="Synthetic project",
        valid_until=date.today() + timedelta(days=30),
    )
    CostItem.objects.create(
        quote=q, description="INTERNAL DESIGN COST", quantity=1, unit_cost=65000
    )
    api = APIClient()
    api.force_authenticate(u)
    return u, other, c, q, api


def test_real_redis_hit_miss_and_expiry(setup, settings):
    settings.RATE_LATEST_TTL = 1
    first = rates.lookup("INR", "USD", owner=setup[0].id)
    second = rates.lookup("INR", "USD", owner=setup[0].id)
    assert first["cache"] == "miss" and second["cache"] == "hit"
    time.sleep(1.05)
    third = rates.lookup("INR", "USD", owner=setup[0].id)
    assert third["cache"] == "miss" and third["version"] != first["version"]
    assert RateSnapshot.objects.count() == 2


def test_input_and_rate_invalidation(setup):
    u, _, _, q, api = setup
    a = evaluate(q)
    b = evaluate(q)
    assert b["calculation_cache"] == "hit"
    r = api.patch(
        f"/api/quotes/{q.id}/",
        {"costs": [{"description": "Changed", "quantity": "1", "unit_cost": "90000"}]},
        format="json",
    )
    assert r.status_code == 200
    q.refresh_from_db()
    c = evaluate(q)
    assert c["calculation_cache"] == "miss" and c["cost"] == "90000.00"
    d = evaluate(q, refresh=True)
    assert (
        d["rate_provenance"]["version"] != c["rate_provenance"]["version"]
        and d["calculation_cache"] == "miss"
    )
    assert AuditEvent.objects.filter(owner=u, cause__contains="Draft inputs").exists()


def test_user_isolation_every_operation(setup):
    _, other, c, q, _ = setup
    api = APIClient()
    api.force_authenticate(other)
    for verb in ["calculate", "finalise", "duplicate", "scenario"]:
        assert (
            api.post(f"/api/quotes/{q.id}/{verb}/", {}, format="json").status_code
            == 404
        )
    assert api.get(f"/api/quotes/{q.id}/export/").status_code == 404
    assert (
        api.patch(f"/api/clients/{c.id}/", {"name": "bad"}, format="json").status_code
        == 404
    )
    assert api.get("/api/quotes/").data == []
    r = api.post(
        "/api/quotes/",
        {"client": c.id, "title": "bad", "valid_until": str(date.today()), "costs": []},
        format="json",
    )
    assert r.status_code == 400


def test_finalised_snapshot_and_exports(setup):
    _, _, _, q, api = setup
    r = api.post(f"/api/quotes/{q.id}/finalise/", {}, format="json")
    assert r.status_code == 200
    q.refresh_from_db()
    original = json.dumps(q.snapshot, sort_keys=True)
    rates.lookup("INR", "USD", refresh=True)
    assert (
        api.patch(
            f"/api/quotes/{q.id}/", {"title": "changed"}, format="json"
        ).status_code
        == 400
    )
    assert (
        api.post(f"/api/quotes/{q.id}/archive/", {}, format="json").status_code == 400
    )
    assert (
        api.post(f"/api/quotes/{q.id}/finalise/", {}, format="json").status_code == 400
    )
    assert (
        api.post(
            f"/api/quotes/{q.id}/calculate/", {"refresh": True}, format="json"
        ).data["calculation_cache"]
        == "snapshot"
    )
    q.refresh_from_db()
    assert json.dumps(q.snapshot, sort_keys=True) == original
    pdf = api.get(f"/api/quotes/{q.id}/export/")
    assert pdf.status_code == 200
    text = "".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf.content)).pages)
    for internal in [
        "INTERNAL DESIGN COST",
        "65000",
        "profit",
        "margin",
        "net_revenue",
    ]:
        assert internal not in text
    assert "Synthetic project" in text and "USD" in text and "Version 1" in text
    csv = api.get(f"/api/quotes/{q.id}/export/?kind=csv")
    assert b"INTERNAL DESIGN COST" in csv.content and b"profit" in csv.content
    dup = api.post(f"/api/quotes/{q.id}/duplicate/", {}, format="json")
    assert (
        dup.status_code == 201
        and dup.data["status"] == "draft"
        and dup.data["revision"] == 2
    )


def test_failed_refresh_keeps_valid_rate(setup, monkeypatch):
    a = rates.lookup("INR", "USD")

    def fail(*args):
        raise RateError("Upstream unavailable")

    monkeypatch.setattr(rates, "fetch", fail)
    with pytest.raises(RateError):
        rates.lookup("INR", "USD", refresh=True)
    assert rates.lookup("INR", "USD")["version"] == a["version"]


def test_redis_failure_uses_no_invented_rate(setup, monkeypatch):
    def broken():
        raise redis.ConnectionError("offline")

    monkeypatch.setattr(cache, "connection", broken)
    row = rates.lookup("INR", "USD")
    assert row["rate"] == ".01044" and row["ttl"] is None and not row["redis_available"]
    q = setup[3]
    assert evaluate(q)["cost"] == "65000.00"


def test_stampede_and_concurrent_refresh_real_redis(setup, monkeypatch):
    count = 0
    mutex = threading.Lock()

    def provider(*args):
        nonlocal count
        with mutex:
            count += 1
        time.sleep(
            0.15
        )  # Test-only barrier to exercise simultaneous miss handling, never a benchmark delay.
        return fixture_rate(*args)

    monkeypatch.setattr(rates, "fetch", provider)

    def task(refresh):
        close_old_connections()
        try:
            return rates.lookup("INR", "USD", refresh=refresh)
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=5) as pool:
        rows = list(pool.map(task, [False] * 5))
    assert count == 1 and len({r["version"] for r in rows}) == 1
    with ThreadPoolExecutor(max_workers=5) as pool:
        rows = list(pool.map(task, [True] * 5))
    assert count == 2 and len({r["version"] for r in rows}) == 1


def test_stale_calculation_race_cannot_publish_current_result(setup, monkeypatch):
    q = setup[3]
    api = setup[4]
    from quotes import services

    original = services.calculate

    def mutate_then_calculate(**kwargs):
        api.patch(
            f"/api/quotes/{q.id}/",
            {
                "costs": [
                    {"description": "New cost", "quantity": 1, "unit_cost": "12345"}
                ]
            },
            format="json",
        )
        return original(**kwargs)

    monkeypatch.setattr(services, "calculate", mutate_then_calculate)
    with pytest.raises(CalculationConflict, match="Draft changed"):
        evaluate(q)
    q.refresh_from_db()
    assert q.version == 2 and q.last_calculation is None
    monkeypatch.setattr(services, "calculate", original)
    new = evaluate(q)
    assert (
        new["cost"] == "12345.00"
        and new["input_version"] == q.version
        and new["calculation_cache"] == "miss"
    )


def test_owned_lock_release_and_bounded_wait(setup):
    key = "qg:test:owned-lock"
    c = cache.connection()
    c.delete(key)
    l = cache.Lock(key)
    assert l.acquire()
    c.set(key, "different-owner", ex=3)
    l.release()
    assert c.get(key) == "different-owner"
    start = time.monotonic()
    other = cache.Lock(key)
    assert not other.acquire()
    assert time.monotonic() - start < 2
    c.delete(key)


def test_identity_no_external_request(setup, monkeypatch):
    def fail(*args):
        raise AssertionError("Must not call provider")

    monkeypatch.setattr(rates, "fetch", fail)
    assert rates.lookup("INR", "INR")["rate"] == "1"


def test_provider_date_and_error_handling(setup, monkeypatch):
    monkeypatch.undo()

    class Response:
        content = b'{"date":"2026-10-09","base":"INR","quote":"USD","rate":0.01044}'
        text = content.decode()
        url = (
            "https://api.frankfurter.dev/v2/rate/INR/USD?providers=ecb&date=2026-10-11"
        )

        def raise_for_status(self):
            pass

    monkeypatch.setattr(requests, "get", lambda *a, **k: Response())
    row = rates.fetch("INR", "USD", "2026-10-11")
    assert (
        row["previous_available_date"]
        and row["actual_date"] == "2026-10-09"
        and len(row["response_sha256"]) == 64
    )

    def timeout(*args, **kwargs):
        raise requests.Timeout()

    monkeypatch.setattr(requests, "get", timeout)
    with pytest.raises(RateError):
        rates.fetch("INR", "USD")


def test_session_csrf_and_registration(setup):
    c = DjangoClient(enforce_csrf_checks=True)
    r = c.get("/api/auth/session/")
    assert r.status_code == 200
    assert (
        c.post(
            "/api/auth/login/",
            data=json.dumps({"username": "owner", "password": "OwnerPassword!2026"}),
            content_type="application/json",
        ).status_code
        == 403
    )
    token = r.json()["csrf"]
    r = c.post(
        "/api/auth/login/",
        data=json.dumps({"username": "owner", "password": "OwnerPassword!2026"}),
        content_type="application/json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert r.status_code == 200 and r.json()["user"]["username"] == "owner"
    assert (
        c.post(
            "/api/clients/",
            data=json.dumps({"name": "bad"}),
            content_type="application/json",
        ).status_code
        == 403
    )
    c = DjangoClient(enforce_csrf_checks=True)
    token = c.get("/api/auth/session/").json()["csrf"]
    r = c.post(
        "/api/auth/register/",
        data=json.dumps({"username": "newowner", "password": "NewOwnerPassword!2026"}),
        content_type="application/json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert r.status_code == 200


def test_refresh_invalidation_does_not_affect_other_input_versions(setup):
    q = setup[3]
    a = evaluate(q)
    b = evaluate(q, True)
    c = evaluate(q)
    assert (
        a["calculation_cache"] == "miss"
        and b["calculation_cache"] == "miss"
        and c["calculation_cache"] == "hit"
    )
    assert a["rate_provenance"]["version"] != b["rate_provenance"]["version"]


def test_database_rejects_snapshot_and_cost_mutations(setup):
    from django.db import DatabaseError

    q = setup[3]
    api = setup[4]
    assert (
        api.post(f"/api/quotes/{q.id}/finalise/", {}, format="json").status_code == 200
    )
    for fn in [
        lambda: Quote.objects.filter(pk=q.pk).update(title="illegal"),
        lambda: CostItem.objects.filter(quote=q).update(unit_cost=1),
        lambda: CostItem.objects.create(
            quote=q, description="illegal", quantity=1, unit_cost=1
        ),
        lambda: q.delete(),
    ]:
        with pytest.raises(DatabaseError):
            with transaction.atomic():
                fn()


def test_finalisation_detects_concurrent_input_change(setup, monkeypatch):
    from quotes import views

    q = setup[3]
    api = setup[4]
    original = views.evaluate

    def race(quote):
        result = original(quote)
        api.patch(f"/api/quotes/{quote.id}/", {"target_margin": ".40"}, format="json")
        return result

    monkeypatch.setattr(views, "evaluate", race)
    assert (
        api.post(f"/api/quotes/{q.id}/finalise/", {}, format="json").status_code == 409
    )
    q.refresh_from_db()
    assert q.status == "draft" and q.snapshot is None


def test_invalidation_after_commit_only(setup):
    from quotes.services import changed

    q = setup[3]
    with pytest.raises(RuntimeError):
        with transaction.atomic():
            changed(q, "Must not publish")
            raise RuntimeError("rollback")
    assert not AuditEvent.objects.filter(cause="Must not publish").exists()


def test_unsupported_pair_and_invalid_dates(setup, monkeypatch):
    monkeypatch.undo()
    with pytest.raises(RateError):
        rates.lookup("INR", "XYZ")
    with pytest.raises(RateError):
        rates.lookup("INR", "USD", date.today() + timedelta(days=1))

    class Bad:
        content = b'{"date":"2026-10-12","base":"INR","quote":"USD","rate":0}'
        text = content.decode()
        url = "https://api.frankfurter.dev/"

        def raise_for_status(self):
            pass

    with patch.object(requests, "get", return_value=Bad()):
        with pytest.raises(RateError):
            rates.fetch("INR", "USD")


def test_cost_change_reviews_fixed_draft_price(setup):
    q = setup[3]
    api = setup[4]
    old = evaluate(q)
    q.refresh_from_db()
    assert q.proposed_price is not None
    api.patch(
        f"/api/quotes/{q.id}/",
        {"costs": [{"description": "New cost", "quantity": 1, "unit_cost": "90000"}]},
        format="json",
    )
    q.refresh_from_db()
    new = evaluate(q)
    assert new["gross_price"] == old["gross_price"]
    assert new["needs_review"] and Decimal(new["margin"]) < Decimal(q.target_margin)
    assert (
        new["change"]["old_profit"] == old["profit"]
        and new["change"]["new_profit"] == new["profit"]
    )


def test_expired_lock_owner_cannot_overwrite_new_rate(setup):
    k = "qg:test:publication"
    c = cache.connection()
    c.delete(k, k + ":lock")
    lock = cache.Lock(k + ":lock")
    assert lock.acquire()
    c.set(k + ":lock", "new-worker", ex=6)
    cache.set_value(k, {"version": "new"}, 60)
    assert not lock.publish(k, {"version": "old"}, 60)
    assert cache.get(k)["version"] == "new"
    lock.release()
    assert c.get(k + ":lock") == "new-worker"
    c.delete(k, k + ":lock")


@pytest.mark.parametrize("verb", ["login", "register"])
@pytest.mark.parametrize(
    "payload",
    [
        [],
        None,
        {"username": None, "password": None},
        {"username": "owner", "password": 123},
    ],
)
def test_auth_malformed_payload_never_crashes(setup, verb, payload):
    c = DjangoClient()
    c.raise_request_exception = False
    response = c.post(
        f"/api/auth/{verb}/", data=json.dumps(payload), content_type="application/json"
    )
    assert response.status_code == 400


def test_archive_isolation_returns_404(setup):
    _, other, _, q, _ = setup
    api = APIClient()
    api.force_authenticate(other)
    assert (
        api.post(f"/api/quotes/{q.id}/archive/", {}, format="json").status_code == 404
    )


@pytest.mark.parametrize(
    "change", ["bad", "NaN", "Infinity", "-Infinity", None, 101, -100]
)
def test_invalid_scenario_is_validation_error(setup, change):
    q = setup[3]
    api = setup[4]
    api.raise_request_exception = False
    assert (
        api.post(
            f"/api/quotes/{q.id}/scenario/", {"change_percent": change}, format="json"
        ).status_code
        == 400
    )


def test_stale_editor_cannot_overwrite_newer_draft(setup):
    q = setup[3]
    api = setup[4]
    assert (
        api.patch(
            f"/api/quotes/{q.id}/",
            {"title": "Newer", "version": q.version},
            format="json",
        ).status_code
        == 200
    )
    r = api.patch(
        f"/api/quotes/{q.id}/", {"title": "Older", "version": q.version}, format="json"
    )
    assert r.status_code == 409
    q.refresh_from_db()
    assert q.title == "Newer"


def test_input_and_rate_staleness_exposed(setup):
    q = setup[3]
    api = setup[4]
    evaluate(q)
    api.patch(f"/api/quotes/{q.id}/", {"currency": "EUR"}, format="json")
    r = api.get(f"/api/quotes/{q.id}/")
    assert r.data["calculation_stale"]
    q.refresh_from_db()
    evaluate(q)
    assert not api.get(f"/api/quotes/{q.id}/").data["calculation_stale"]
    rates.lookup("INR", "EUR", refresh=True)
    assert api.get(f"/api/quotes/{q.id}/").data["calculation_stale"]


def test_cache_corruption_becomes_miss(setup):
    cache.connection().set(rates.key("INR", "USD", None), "[1,2,3]", ex=60)
    assert rates.lookup("INR", "USD")["cache"] == "miss"


def test_finalised_client_label_is_snapshot(setup):
    q = setup[3]
    api = setup[4]
    assert (
        api.post(f"/api/quotes/{q.id}/finalise/", {}, format="json").status_code == 200
    )
    api.patch(f"/api/clients/{q.client_id}/", {"name": "Renamed client"}, format="json")
    assert api.get(f"/api/quotes/{q.id}/").data["client_name"] == "Synthetic Client"


def test_archived_calculation_and_finalisation_rejected(setup):
    q = setup[3]
    api = setup[4]
    assert (
        api.post(f"/api/quotes/{q.id}/archive/", {}, format="json").status_code == 200
    )
    assert (
        api.post(f"/api/quotes/{q.id}/calculate/", {}, format="json").status_code == 400
    )
    assert (
        api.post(f"/api/quotes/{q.id}/finalise/", {}, format="json").status_code == 400
    )


@pytest.mark.parametrize("payload", [[], None, {"refresh": {"invalid": True}}])
def test_calculation_payload_validation(setup, payload):
    q = setup[3]
    api = setup[4]
    api.raise_request_exception = False
    r = api.post(
        f"/api/quotes/{q.id}/calculate/",
        json.dumps(payload),
        content_type="application/json",
    )
    assert r.status_code == 400


def test_extreme_supported_inputs_fail_cleanly(setup):
    q = setup[3]
    api = setup[4]
    api.raise_request_exception = False
    assert (
        api.patch(
            f"/api/quotes/{q.id}/",
            {"fee_percent": ".999999", "fixed_fee": "999999999999.9999"},
            format="json",
        ).status_code
        == 200
    )
    assert (
        api.post(f"/api/quotes/{q.id}/calculate/", {}, format="json").status_code == 400
    )


@pytest.mark.parametrize(
    "payload",
    [
        {"rate": "NaN", "version": "corrupt"},
        {"rate": "-1", "version": "corrupt"},
        {"rate": "1"},
    ],
)
def test_invalid_cached_rate_dictionary_is_replaced(setup, payload):
    cache.set_value(rates.key("INR", "USD", None), payload, 60)
    result = rates.lookup("INR", "USD", owner=setup[0].id)
    assert result["cache"] == "miss" and result["version"] != "corrupt"


@pytest.mark.parametrize(
    "payload",
    [
        {"operation": "unknown"},
        {"operation": "cold", "currency": "XYZ"},
        {"operation": "expiry", "start": []},
    ],
)
def test_invalid_lab_requests_are_rejected(setup, payload):
    assert setup[-1].post("/api/lab/", payload, format="json").status_code == 400


@pytest.mark.parametrize("value", ["not-a-date", "2099-01-01"])
def test_rate_date_errors_are_explicit(setup, value):
    with pytest.raises(RateError):
        rates.lookup("INR", "USD", value)


def test_corrupt_calculation_dictionary_recomputed(setup):
    from quotes.services import inputs, calculation_key

    q = setup[3]
    first = evaluate(q)
    q.refresh_from_db()
    key = calculation_key(q, q.version, inputs(q), first["rate_provenance"])
    cache.set_value(key, {"garbage": "broken payload"}, 60)
    second = evaluate(q)
    assert second["calculation_cache"] == "miss"
    assert second["gross_price"] == first["gross_price"]


def test_margin_plan_is_readonly_and_uses_recorded_rate(setup, monkeypatch):
    q, api = setup[3], setup[4]
    before = evaluate(q)
    q.refresh_from_db()
    original = (q.version, q.proposed_price, q.target_margin, q.last_calculation)
    monkeypatch.setattr(
        rates,
        "fetch",
        lambda *a, **kw: (_ for _ in ()).throw(
            AssertionError("Planner must not fetch rates")
        ),
    )
    result = api.post(
        f"/api/quotes/{q.id}/plan/", {"target_margin": ".5"}, format="json"
    )
    assert result.status_code == 200
    data = result.json()
    assert data["hypothetical"] and Decimal(data["margin"]) >= Decimal(".5")
    assert data["rate_provenance"] == before["rate_provenance"]
    q.refresh_from_db()
    assert (
        q.version,
        q.proposed_price,
        q.target_margin,
        q.last_calculation,
    ) == original


@pytest.mark.parametrize("value", ["1", "-.1", "NaN", [], "oops", ".12345"])
def test_plan_validates_target(setup, value):
    q, api = setup[3], setup[4]
    assert (
        api.post(
            f"/api/quotes/{q.id}/plan/", {"target_margin": value}, format="json"
        ).status_code
        == 400
    )


def test_plan_requires_current_calculation_and_ownership(setup):
    q, api = setup[3], setup[4]
    assert (
        api.post(
            f"/api/quotes/{q.id}/plan/", {"target_margin": ".4"}, format="json"
        ).status_code
        == 409
    )
    evaluate(q)
    api.patch(f"/api/quotes/{q.id}/", {"fixed_fee": "2"}, format="json")
    assert (
        api.post(
            f"/api/quotes/{q.id}/plan/", {"target_margin": ".4"}, format="json"
        ).status_code
        == 409
    )
    api.force_authenticate(setup[1])
    assert (
        api.post(
            f"/api/quotes/{q.id}/plan/", {"target_margin": ".4"}, format="json"
        ).status_code
        == 404
    )


def test_frozen_plan_preserves_snapshot_and_archived_plan_rejected(setup):
    q, api = setup[3], setup[4]
    final = api.post(f"/api/quotes/{q.id}/finalise/", {}, format="json").json()
    r = api.post(f"/api/quotes/{q.id}/plan/", {"target_margin": ".4"}, format="json")
    assert r.status_code == 200
    assert api.get(f"/api/quotes/{q.id}/").json()["snapshot"] == final["snapshot"]
    draft = api.post(f"/api/quotes/{q.id}/duplicate/", {}, format="json").json()
    api.post(f"/api/quotes/{draft['id']}/archive/", {}, format="json")
    assert (
        api.post(
            f"/api/quotes/{draft['id']}/plan/", {"target_margin": ".4"}, format="json"
        ).status_code
        == 400
    )


@pytest.mark.parametrize("action,payload", [("calculate", {}), ("scenario", {"change_percent": "5"}), ("finalise", {})])
def test_calculation_api_rejects_concurrent_input_change(setup, monkeypatch, action, payload):
    from quotes import services

    q, api = setup[3], setup[4]
    original = services.calculate

    def racing_calculation(**kwargs):
        response = api.patch(f"/api/quotes/{q.id}/", {"target_margin": ".40"}, format="json")
        assert response.status_code == 200
        return original(**kwargs)

    monkeypatch.setattr(services, "calculate", racing_calculation)
    response = api.post(f"/api/quotes/{q.id}/{action}/", payload, format="json")
    assert response.status_code == 409
    assert "Draft changed" in response.data["detail"]
    q.refresh_from_db()
    assert q.last_calculation is None and q.status == "draft"


def test_calculation_rejects_concurrent_rate_refresh(setup, monkeypatch):
    from quotes import services

    q, api = setup[3], setup[4]
    original = services.calculate

    def refresh_then_calculate(**kwargs):
        rates.lookup("INR", "USD", refresh=True, owner=q.owner_id)
        return original(**kwargs)

    monkeypatch.setattr(services, "calculate", refresh_then_calculate)
    response = api.post(f"/api/quotes/{q.id}/calculate/", {}, format="json")
    assert response.status_code == 409
    assert "Reference rate changed" in response.data["detail"]
    q.refresh_from_db()
    assert q.last_calculation is None


def test_cache_replay_records_real_keys_versions_and_work(setup):
    _, _, _, q, api = setup
    first = api.post(f"/api/quotes/{q.id}/calculate/", {}, format="json").json()
    trace = first["request_trace"]
    assert trace["decision"] == "miss"
    assert trace["provider_called"] and trace["calculation_executed"]
    assert trace["lookup_input_version"] + 1 == trace["input_version"]
    assert trace["cache_key"] != trace["result_key"]  # suggested price adoption
    second = api.post(f"/api/quotes/{q.id}/calculate/", {}, format="json").json()
    assert second["request_trace"]["decision"] == "hit"
    assert not second["request_trace"]["provider_called"]
    assert not second["request_trace"]["calculation_executed"]
    assert second["request_trace"]["cache_key"] == trace["result_key"]
    assert second["request_trace"]["request_id"] != trace["request_id"]
    old_version = second["input_version"]
    response = api.patch(f"/api/quotes/{q.id}/", {"version": old_version, "costs": [
        {"description": "Changed", "quantity": "1", "unit_cost": "72000"}
    ]}, format="json")
    assert response.status_code == 200
    assert response.json()["version"] == old_version + 1
    third = api.post(f"/api/quotes/{q.id}/calculate/", {}, format="json").json()
    assert third["request_trace"]["decision"] == "miss"
    assert third["request_trace"]["cache_key"] != second["request_trace"]["result_key"]
    assert not third["request_trace"]["provider_called"]
    assert third["request_trace"]["calculation_executed"]
    fourth = api.post(f"/api/quotes/{q.id}/calculate/", {}, format="json").json()
    assert fourth["request_trace"]["decision"] == "hit"
    assert fourth["gross_price"] == first["gross_price"]
    assert fourth["cost"] == "72000.00"


def test_cache_replay_snapshot_fingerprint_is_fixed(setup):
    _, other, _, q, api = setup
    assert api.post(f"/api/quotes/{q.id}/finalise/", {}, format="json").status_code == 200
    baseline = api.post(f"/api/quotes/{q.id}/calculate/", {}, format="json").json()
    revised = api.post(f"/api/quotes/{q.id}/duplicate/", {}, format="json")
    assert revised.status_code == 201
    revision_id = revised.json()["id"]
    assert api.patch(f"/api/quotes/{revision_id}/", {"costs": [
        {"description": "Revision cost", "quantity": "1", "unit_cost": "80000"}
    ]}, format="json").status_code == 200
    api.post(f"/api/quotes/{revision_id}/calculate/", {}, format="json")
    after = api.post(f"/api/quotes/{q.id}/calculate/", {}, format="json").json()
    assert baseline["request_trace"]["snapshot_sha256"] == after["request_trace"]["snapshot_sha256"]
    assert after["request_trace"]["decision"] == "snapshot"
    assert not after["request_trace"]["provider_called"]
    assert not after["request_trace"]["calculation_executed"]
    assert after["request_trace"]["cache_key"] is None
    assert baseline["gross_price"] == after["gross_price"]
    api.force_authenticate(other)
    assert api.post(f"/api/quotes/{q.id}/calculate/", {}, format="json").status_code == 404


def test_cache_replay_does_not_claim_failed_cache_write(setup, monkeypatch):
    _, _, _, q, api = setup
    evaluate(q)  # warm the rate before disabling calculation storage
    q.refresh_from_db()
    cache.connection().delete(q.last_calculation["request_trace"]["result_key"])
    monkeypatch.setattr(cache, "set_value", lambda *a, **kw: False)
    receipt = api.post(f"/api/quotes/{q.id}/calculate/", {}, format="json").json()
    assert receipt["request_trace"]["decision"] == "miss"
    assert not receipt["request_trace"]["cache_written"]
    assert receipt["request_trace"]["calculation_executed"]
