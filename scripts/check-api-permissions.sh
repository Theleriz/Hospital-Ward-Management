#!/usr/bin/env bash
# Run from any directory; only this run's disposable Docker project is removed.
set -euo pipefail
cd "$(dirname "$0")/.."
project="medbase-permissions-$$"
compose=(docker compose -f docker-compose.permissions.yml -p "$project")
cleanup() { "${compose[@]}" down -v --remove-orphans; }
trap cleanup EXIT
mkdir -p artifacts/api-permissions
"${compose[@]}" up -d --wait db
"${compose[@]}" run --rm --no-deps tests
