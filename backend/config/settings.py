import os
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
from django.core.exceptions import ImproperlyConfigured

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "local-development-only-change-me")
ON_VERCEL = os.environ.get("VERCEL") == "1"
if ON_VERCEL and (len(SECRET_KEY) < 50 or SECRET_KEY.startswith("local-")):
    raise ImproperlyConfigured("Set a random DJANGO_SECRET_KEY before deployment.")
DEBUG = os.environ.get("DEBUG", "0") == "1"
if ON_VERCEL and DEBUG:
    raise ImproperlyConfigured("DEBUG must be disabled on Vercel.")
ALLOWED_HOSTS = os.environ.get(
    "ALLOWED_HOSTS", "localhost,127.0.0.1,backend,testserver"
).split(",")
for host in (os.environ.get("VERCEL_URL"), os.environ.get("VERCEL_PROJECT_PRODUCTION_URL")):
    if host and host not in ALLOWED_HOSTS:
        ALLOWED_HOSTS.append(host)
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.messages",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.staticfiles",
    "rest_framework",
    "quotes",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("POSTGRES_DB", "quoteguard"),
        "USER": os.environ.get("POSTGRES_USER", "quoteguard"),
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", "local-only-quoteguard"),
        "HOST": os.environ.get("DATABASE_HOST", "127.0.0.1"),
        "PORT": os.environ.get("DATABASE_PORT", "55432"),
    }
}
if os.environ.get("DATABASE_URL"):
    database_url = urlsplit(os.environ["DATABASE_URL"])
    if database_url.scheme not in {"postgres", "postgresql"}:
        raise ImproperlyConfigured("DATABASE_URL must use PostgreSQL.")
    query = parse_qs(database_url.query)
    DATABASES["default"].update(
        NAME=unquote(database_url.path.lstrip("/")),
        USER=unquote(database_url.username or ""),
        PASSWORD=unquote(database_url.password or ""),
        HOST=database_url.hostname,
        PORT=str(database_url.port or 5432),
        CONN_MAX_AGE=0,
        OPTIONS={"sslmode": query.get("sslmode", ["require"])[0], "connect_timeout": 10},
        DISABLE_SERVER_SIDE_CURSORS=True,
    )
elif ON_VERCEL:
    raise ImproperlyConfigured("Set a persistent PostgreSQL DATABASE_URL on Vercel.")
REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication"
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "COERCE_DECIMAL_TO_STRING": True,
}
REDIS_URL = os.environ.get("REDIS_URL") or os.environ.get("KV_URL") or "redis://127.0.0.1:56379/0"
if ON_VERCEL and not REDIS_URL.startswith("rediss://"):
    raise ImproperlyConfigured("Set a TLS Redis URL (rediss://) on Vercel.")
REDIS_SOCKET_TIMEOUT = float(os.environ.get("REDIS_SOCKET_TIMEOUT", "1" if ON_VERCEL else "0.3"))
RATE_LATEST_TTL = int(os.environ.get("RATE_LATEST_TTL", "3600"))
RATE_HISTORY_TTL = int(os.environ.get("RATE_HISTORY_TTL", "604800"))
CALC_TTL = int(os.environ.get("CALC_TTL", "900"))
USE_TZ = True
TIME_ZONE = "UTC"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
]
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "1" if ON_VERCEL else "0") == "1"
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https") if ON_VERCEL else None
SECURE_SSL_REDIRECT = ON_VERCEL
SECURE_HSTS_SECONDS = 31536000 if ON_VERCEL else 0
X_FRAME_OPTIONS = "DENY"
CSRF_TRUSTED_ORIGINS = [x for x in os.environ.get("CSRF_TRUSTED_ORIGINS", "").split(",") if x]
STATIC_URL = "/api/static/"
STATIC_ROOT = Path(__file__).resolve().parents[2] / "staticfiles"

# Keep admin and its assets under the existing backend proxy prefix.
TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]
