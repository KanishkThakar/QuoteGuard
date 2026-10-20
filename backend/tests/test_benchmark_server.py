"""Backend contract tests; the repeated HTTP benchmark remains Aarav's assignment."""
from pathlib import Path
from types import SimpleNamespace

import pytest
from django.core.management import call_command, CommandError

from quotes import cache, rates
from quotes.management.commands import serve_benchmark
from quotes.management.commands.serve_benchmark import RecordedProvider, recorded_mode, validate_isolation

EVIDENCE = Path(__file__).resolve().parents[2] / "evidence"


def test_original_response_and_no_live_fallback():
    provider = RecordedProvider(EVIDENCE)
    result = provider("INR", "USD")
    assert result["response_sha256"] == provider.sha256
    assert result["source"].startswith("Recorded original")
    assert provider.calls == 1
    for args in [("INR", "EUR"), ("INR", "USD", "2026-10-09")]:
        with pytest.raises(rates.RateError, match="no live fallback"):
            provider(*args)
    assert provider.calls == 1


def test_tampered_evidence_is_rejected(tmp_path):
    for path in EVIDENCE.glob("frankfurter-inr-usd*"):
        (tmp_path / path.name).write_bytes(path.read_bytes())
    (tmp_path / "frankfurter-inr-usd.json").write_text('{}')
    with pytest.raises(CommandError, match="hash"):
        RecordedProvider(tmp_path)


def test_uncached_mode_is_process_scoped_and_restored():
    original_get, original_fetch = cache.get, rates.fetch
    provider = RecordedProvider(EVIDENCE)
    with recorded_mode(provider, "uncached"):
        assert cache.get("any-key") is None
        assert not cache.set_value("any-key", {}, 5)
        assert not cache.Lock("any-key:lock").publish("any-key", {}, 5)
        assert rates.fetch("INR", "USD")["response_sha256"] == provider.sha256
    assert cache.get is original_get and rates.fetch is original_fetch


def test_command_refuses_regular_app_database(monkeypatch):
    monkeypatch.setattr(serve_benchmark, "settings", SimpleNamespace(
        DATABASES={"default": {"NAME": "quoteguard", "HOST": "127.0.0.1"}},
        REDIS_URL="redis://127.0.0.1:6379/14",
    ))
    with pytest.raises(CommandError, match="_benchmark"):
        call_command("serve_benchmark", mode="cached")


@pytest.mark.parametrize("url", ["redis://127.0.0.1:6379/0", "redis://example.com:6379/14", "redis://127.0.0.1:6379/15"])
def test_command_refuses_shared_or_remote_redis(monkeypatch, url):
    monkeypatch.setattr(serve_benchmark, "settings", SimpleNamespace(
        DATABASES={"default": {"NAME": "quoteguard_benchmark", "HOST": "127.0.0.1"}},
        REDIS_URL=url,
    ))
    with pytest.raises(CommandError, match="dedicated local Redis"):
        validate_isolation()
