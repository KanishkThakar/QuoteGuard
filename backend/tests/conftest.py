import pytest


@pytest.fixture(autouse=True)
def isolated_redis_database(settings):
    # Actual Redis, but database 15 keeps test keys away from the running app.
    settings.REDIS_URL = settings.REDIS_URL.rsplit("/", 1)[0] + "/15"
