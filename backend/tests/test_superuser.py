"""Exercise real superuser sessions without leaving privileged demo accounts."""

import json

import pytest
from django.contrib.auth import get_user_model
from django.test import Client


@pytest.mark.django_db
def test_superuser_session_csrf_and_owner_isolation():
    from quotes.models import Client as QuoteClient

    users = get_user_model()
    owner = users.objects.create_user("ordinary_owner")
    QuoteClient.objects.create(owner=owner, name="Private client", currency="INR")
    admin = users.objects.create_superuser(
        "synthetic_admin", "admin@example.invalid", "SyntheticAdmin!2026"
    )
    assert admin.is_staff and admin.is_superuser and admin.is_active
    browser = Client(enforce_csrf_checks=True)
    csrf = browser.get("/api/auth/session/").json()["csrf"]
    payload = json.dumps({"username": admin.username, "password": "SyntheticAdmin!2026"})
    assert browser.post("/api/auth/login/", payload, content_type="application/json").status_code == 403
    response = browser.post(
        "/api/auth/login/", payload, content_type="application/json", HTTP_X_CSRFTOKEN=csrf
    )
    assert response.status_code == 200
    assert response.json()["user"]["id"] == admin.id
    assert browser.get("/api/auth/session/").json()["user"]["id"] == admin.id
    # The product API intentionally scopes all accounts, including superusers, by owner.
    assert browser.get("/api/clients/").json() == []
    response = browser.post(
        "/api/clients/",
        json.dumps({"name": "Synthetic admin client", "currency": "INR"}),
        content_type="application/json",
        HTTP_X_CSRFTOKEN=response.json()["csrf"],
    )
    assert response.status_code == 201
    assert QuoteClient.objects.get(pk=response.json()["id"]).owner_id == admin.id
    csrf = browser.get("/api/auth/session/").json()["csrf"]
    assert browser.post(
        "/api/auth/logout/", "{}", content_type="application/json", HTTP_X_CSRFTOKEN=csrf
    ).status_code == 200
    assert browser.get("/api/auth/session/").json()["user"] is None
    assert browser.get("/api/clients/").status_code == 403


@pytest.mark.django_db
def test_inactive_superuser_cannot_sign_in():
    get_user_model().objects.create_superuser(
        "inactive_admin", "inactive@example.invalid", "SyntheticAdmin!2026", is_active=False
    )
    browser = Client(enforce_csrf_checks=True)
    csrf = browser.get("/api/auth/session/").json()["csrf"]
    response = browser.post(
        "/api/auth/login/",
        json.dumps({"username": "inactive_admin", "password": "SyntheticAdmin!2026"}),
        content_type="application/json",
        HTTP_X_CSRFTOKEN=csrf,
    )
    assert response.status_code == 400
    assert browser.get("/api/auth/session/").json()["user"] is None
