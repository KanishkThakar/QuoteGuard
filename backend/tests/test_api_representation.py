import pytest
from rest_framework.test import APIClient


@pytest.mark.django_db
def test_health_opened_in_a_browser_returns_json():
    response = APIClient().get(
        '/api/health/',
        HTTP_ACCEPT='text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    )
    assert response.status_code == 200
    assert response['Content-Type'].startswith('application/json')
    assert response.json() == {
        'database': 'ok', 'redis': 'ok', 'application': 'ok',
    }
