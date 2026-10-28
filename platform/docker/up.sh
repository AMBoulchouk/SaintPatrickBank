#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

echo "==> Starting PostgreSQL 18 container..."
docker compose -f "$COMPOSE_FILE" up -d

echo "==> Waiting for PostgreSQL 18 to be healthy..."
until docker exec spbk_postgres18 pg_isready -U spbk_admin -d saintpatrickbk_dev >/dev/null 2>&1; do
  sleep 1
done

echo "==> Applying database initialization script (idempotent)..."
docker exec -i spbk_postgres18 psql -U spbk_admin -d saintpatrickbk_dev < "$SCRIPT_DIR/initdb/01-init-databases.sql" >/dev/null 2>&1 || true

echo "==> PostgreSQL 18 is ready and initialized."
