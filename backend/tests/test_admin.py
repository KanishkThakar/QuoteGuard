"""Verify that the backend proxy exposes admin with working permissions and assets."""
import pytest
from django.contrib.auth import get_user_model
from django.test import Client
from django.urls import reverse


@pytest.mark.django_db
def test_admin_requires_staff_and_allows_superuser():
    browser = Client()
    admin_url = reverse("admin:index")
    assert admin_url == "/api/admin/"
    assert browser.get(admin_url).status_code == 302
    ordinary = get_user_model().objects.create_user("admin_test_ordinary")
    browser.force_login(ordinary)
    assert browser.get(admin_url).status_code == 302
    superuser = get_user_model().objects.create_superuser("admin_test_superuser", password="AdminTest!2026")
    browser.force_login(superuser)
    response = browser.get(admin_url)
    assert response.status_code == 200
    assert b"/api/static/admin/css/base.css" in response.content
    assert browser.get(reverse("admin:auth_user_changelist")).status_code == 200


def test_admin_login_exposes_csrf_and_backend_static_prefix():
    response = Client().get(reverse("admin:login"))
    assert response.status_code == 200
    assert b"csrfmiddlewaretoken" in response.content
    assert b"/api/static/admin/css/base.css" in response.content
