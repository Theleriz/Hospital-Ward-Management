#!/usr/bin/env bash
# =============================================================================
# Hospital Ward Management System (Team MedBase)
# Rule 1 check: main must always be demo-ready.
#   1. database builds from scratch (docker compose, empty volume)
#   2. automated tests pass
#   3. demo runs to the end without unexpected errors
#   4. queries run, setup.sql is re-runnable, tests pass again
# Used by CI (.github/workflows/db.yml) and locally before opening a PR.
# WARNING: wipes the local database volume (docker compose down -v).
# Run from the repository root:  bash scripts/check-db.sh
# =============================================================================
set -euo pipefail

# Git Bash on Windows would otherwise rewrite /db/... paths
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/.."

CONTAINER=medbase-postgres
PSQL=(docker exec -e PGOPTIONS=--client-min-messages=warning "$CONTAINER"
      psql -U medbase -d hospital_ward -v ON_ERROR_STOP=1)

step() { echo; echo "==> $*"; }
fail() { echo; echo "FAIL: $*"; exit 1; }

step "1. Build database from scratch"
docker compose down -v --remove-orphans
docker compose up -d --wait

init_log=$(docker logs "$CONTAINER" 2>&1)
grep -q '>> Database ready' <<<"$init_log" || { echo "$init_log"; fail "setup.sql did not finish on init"; }

step "2. Automated tests"
"${PSQL[@]}" -f /db/tests/test_hospital_ward.sql

step "3. Demo"
# Errors inside the demo are expected (they show business rules); only broken SQL is a failure
demo_log=$(docker exec "$CONTAINER" psql -U medbase -d hospital_ward -f /db/demo.sql 2>&1 </dev/null)
grep -q 'Demo finished' <<<"$demo_log" || { echo "$demo_log"; fail "demo.sql did not run to the end"; }
if grep -E 'syntax error|(relation|column|function|procedure|role|schema) "?[^ ]+"? does not exist' <<<"$demo_log"; then
    echo "$demo_log"
    fail "demo.sql has broken SQL"
fi
echo "demo.sql ran to the end"

step "4. Queries, re-run of setup.sql, tests again"
"${PSQL[@]}" -f /db/05_queries.sql >/dev/null
"${PSQL[@]}" -q -f /db/setup.sql >/dev/null
"${PSQL[@]}" -f /db/tests/test_hospital_ward.sql

echo
echo "OK: database is demo-ready"
