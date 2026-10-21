#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
docker info >/dev/null
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 180
docker compose exec -T backend python manage.py seed_demo
# Read the actual mapping, including values supplied through .env.
address=$(docker compose port web 80)
printf '\nQuoteGuard: http://%s\nLocal synthetic demo: demo / DemoQuoteGuard!2026\n' "$address"
