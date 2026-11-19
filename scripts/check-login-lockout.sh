#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
project="medbase-lockout-$$"
compose=(docker compose -f docker-compose.lockout.yml -p "$project")
mkdir -p artifacts/login-lockout
cleanup() {
  status=$?
  trap - EXIT
  "${compose[@]}" logs --no-color > artifacts/login-lockout/services.log 2>&1 || true
  "${compose[@]}" down -v --remove-orphans || true
  exit "$status"
}
trap cleanup EXIT
"${compose[@]}" up -d --build --wait db backend
"${compose[@]}" run --rm --no-deps check before
echo 'Restart 1: blocked badge must stay blocked; four errors on another badge must survive.'
"${compose[@]}" restart backend
"${compose[@]}" up -d --wait backend
"${compose[@]}" run --rm --no-deps check after
echo 'Restart 2: the second badge must also remain blocked.'
"${compose[@]}" restart backend
"${compose[@]}" up -d --wait backend
"${compose[@]}" run --rm --no-deps check final
# Only the test fixture is expired; normal application code uses the real 5 minutes.
"${compose[@]}" exec -T db psql -U medbase -d hospital_ward -v ON_ERROR_STOP=1 -c \
  'UPDATE "LoginThrottle" SET "LockedUntil" = clock_timestamp() - INTERVAL '\''1 second'\'' WHERE "LockedUntil" IS NOT NULL' >/dev/null
"${compose[@]}" run --rm --no-deps check expired
echo 'PASS: real backend restarts preserved login state; artifacts/login-lockout/restart.json'
