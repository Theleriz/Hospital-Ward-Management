#!/usr/bin/env bash
# Requires Docker only. Installs browser dependencies while building the image.
set -euo pipefail
cd "$(dirname "$0")/.."
project="medbase-timing-$$"
compose=(docker compose -f docker-compose.timing.yml -p "$project")
export MEDBASE_COMMIT="$(git rev-parse HEAD)"
export MEDBASE_SOURCE_DIRTY="$(test -z "$(git status --porcelain)" && echo false || echo true)"
mkdir -p artifacts/alert-timing
cleanup() {
  status=$?
  trap - EXIT
  "${compose[@]}" logs --no-color > artifacts/alert-timing/services.log 2>&1 || true
  "${compose[@]}" down -v --remove-orphans || true
  exit "$status"
}
trap cleanup EXIT
echo 'Building isolated system and Chromium (first run downloads dependencies)...'
"${compose[@]}" build
"${compose[@]}" up -d --wait db backend frontend
echo 'Measuring 12 deliveries and real 30-second escalation intervals (about 4 minutes)...'
"${compose[@]}" run --rm --no-deps timing
