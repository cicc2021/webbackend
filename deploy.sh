#!/usr/bin/env bash
# Idempotent: safe to re-run, and only succeeds when the API actually answers.
set -euo pipefail
die() { echo "deploy: $*" >&2; exit 1; }
[ -f .env.production ] || die "missing .env.production"
grep -q '^COOKIE_SECURE=true' .env.production || die "COOKIE_SECURE must be true in production"
COMPOSE="docker compose -f docker-compose.prod.yml"
git pull --ff-only
$COMPOSE build
# Refuses to run past a failed migration, so the old container keeps serving.
$COMPOSE run --rm api npx prisma migrate deploy
$COMPOSE up -d
for _ in $(seq 1 30); do
  curl -fsS http://127.0.0.1:4000/api/health && { echo; echo "deploy: healthy"; exit 0; }
  sleep 1
done
$COMPOSE logs --tail 40 api
die "health check failed"
