"""Validate cloud startup guards in a fresh process, separate from test settings."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]


def cloud_settings(**overrides):
    env = {**os.environ, "PYTHONPATH": str(ROOT / "backend"),
           "VERCEL": "1", "DEBUG": "0", "DJANGO_SECRET_KEY": "a-test-only-secret-with-at-least-fifty-characters-123456789",
           "DATABASE_URL": "postgresql://user:pass@db.example.invalid/quotes?sslmode=require",
           "REDIS_URL": "rediss://:password@redis.example.invalid:6379/0",
           "VERCEL_URL": "preview.example.invalid", "VERCEL_PROJECT_PRODUCTION_URL": "production.example.invalid"}
    env.update(overrides)
    script = """import json
from config import settings as s
print(json.dumps({'hosts':s.ALLOWED_HOSTS,'database':s.DATABASES['default'],
 'secure_cookie':s.SESSION_COOKIE_SECURE,'secure_csrf':s.CSRF_COOKIE_SECURE,
 'redirect':s.SECURE_SSL_REDIRECT,'hsts':s.SECURE_HSTS_SECONDS}))"""
    return subprocess.run([sys.executable, "-c", script], env=env, capture_output=True, text=True)


def test_cloud_uses_persistent_database_and_secure_defaults():
    result = cloud_settings()
    assert result.returncode == 0, result.stderr
    values = json.loads(result.stdout)
    assert {"preview.example.invalid", "production.example.invalid"} <= set(values['hosts'])
    assert values['database']['HOST'] == 'db.example.invalid'
    assert values['database']['OPTIONS']['sslmode'] == 'require'
    assert values['database']['CONN_MAX_AGE'] == 0
    assert values['secure_cookie'] and values['secure_csrf'] and values['redirect']
    assert values['hsts'] > 0


@pytest.mark.parametrize("overrides,message", [
    ({"DJANGO_SECRET_KEY": "local-development-only-change-me"}, "random DJANGO_SECRET_KEY"),
    ({"DEBUG": "1"}, "DEBUG must be disabled"),
    ({"DATABASE_URL": "sqlite:///tmp.db"}, "must use PostgreSQL"),
    ({"DATABASE_URL": ""}, "persistent PostgreSQL"),
    ({"REDIS_URL": "redis://localhost:6379/0", "KV_URL": ""}, "TLS Redis"),
])
def test_cloud_refuses_unsafe_or_ephemeral_configuration(overrides, message):
    result = cloud_settings(**overrides)
    assert result.returncode != 0
    assert message in result.stderr
