#!/usr/bin/env bash
# =============================================================================
# Hospital Ward Management System (Team MedBase)
# Full backup -> restore check (T-44).
#   1. backup of the running database (medbase-postgres) with backup-db.sh
#   2. restore with restore-db.sh into a NEW, disposable PostgreSQL container:
#      a fresh cluster has no roles, so this proves the roles are created
#   3. schema and data are checked by SQL that really runs (docker exec -i)
#   4. access rights: medbase_api has no data access of its own, SET LOCAL ROLE
#      gives each role its rights, PublicStaff cannot read Patient
#   5. negative controls: a broken schema and a wrong GRANT must fail the checks
# The team database is only read (pg_dump); nothing is restored into it.
# Run from the repository root:  bash scripts/check-backup.sh
# =============================================================================
set -euo pipefail
umask 077

# Git Bash on Windows would otherwise rewrite paths passed to docker
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/.."

SOURCE_CONTAINER="${MEDBASE_DB_CONTAINER:-medbase-postgres}"
DB_USER="${MEDBASE_DB_USER:-medbase}"
DB_IMAGE="${MEDBASE_DB_IMAGE:-postgres:17}"
CHECK_CONTAINER="medbase-backup-check"
CHECK_DB="hospital_ward"
TMP_DIR="$(mktemp -d)"

step() { echo; echo "==> $*"; }
fail() { echo; echo "FAIL: $*" >&2; exit 1; }

cleanup() {
  rm -rf "${TMP_DIR}"
  docker rm -f "${CHECK_CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# SQL from stdin, as the database owner, in the restored database
psql_owner() {
  docker exec -i -e PGOPTIONS=--client-min-messages=warning "${CHECK_CONTAINER}" \
    psql -U "${DB_USER}" -d "${CHECK_DB}" -X -q -v ON_ERROR_STOP=1
}

# SQL from stdin, as the backend login role medbase_api
psql_api() {
  docker exec -i -e PGOPTIONS=--client-min-messages=warning -e PGPASSWORD=medbase_api "${CHECK_CONTAINER}" \
    psql -U medbase_api -d "${CHECK_DB}" -X -q -v ON_ERROR_STOP=1
}

verify_schema_and_data() {
  psql_owner >/dev/null <<'SQL'
DO $$
DECLARE
    v_tables INT;
    v_views INT;
    v_patients INT;
    v_wards INT;
BEGIN
    SELECT COUNT(*) INTO v_tables
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
    IF v_tables < 8 THEN
        RAISE EXCEPTION 'Expected at least 8 tables after restore, found %', v_tables;
    END IF;

    SELECT COUNT(*) INTO v_views
    FROM information_schema.views
    WHERE table_schema = 'public'
      AND table_name IN ('vw_WardCapacity', 'vw_AlertResponse');
    IF v_views <> 2 THEN
        RAISE EXCEPTION 'Expected 2 views after restore, found %', v_views;
    END IF;

    SELECT COUNT(*) INTO v_patients FROM "Patient";
    SELECT COUNT(*) INTO v_wards FROM "Ward";
    IF v_patients = 0 OR v_wards = 0 THEN
        RAISE EXCEPTION 'Restored tables are empty (patients=%, wards=%)', v_patients, v_wards;
    END IF;

    -- Role memberships are cluster-wide: they come from db/00_roles.sql, not the dump
    IF NOT pg_has_role('medbase_api', 'medbase_public_staff', 'MEMBER')
       OR NOT pg_has_role('medbase_head_nurse', 'medbase_nurse', 'MEMBER') THEN
        RAISE EXCEPTION 'Role memberships are missing after restore';
    END IF;
    IF (SELECT rolinherit FROM pg_roles WHERE rolname = 'medbase_api') THEN
        RAISE EXCEPTION 'medbase_api must be NOINHERIT';
    END IF;
END;
$$;
SQL
}

# expect_allowed <description> <sql>: medbase_api runs the SQL without errors
expect_allowed() {
  local out
  if out=$(psql_api <<<"$2" 2>&1); then
    echo "  ok: $1"
  else
    echo "$out" >&2
    echo "  not allowed: $1" >&2
    return 1
  fi
}

# expect_denied <description> <sql>: medbase_api gets "permission denied"
expect_denied() {
  local out
  if out=$(psql_api <<<"$2" 2>&1); then
    echo "  allowed, but must be denied: $1" >&2
    return 1
  elif grep -q 'permission denied' <<<"$out"; then
    echo "  ok (denied): $1"
  else
    echo "$out" >&2
    echo "  failed with an unexpected error: $1" >&2
    return 1
  fi
}

PUBLIC_STAFF_READS_PATIENT='BEGIN; SET LOCAL ROLE medbase_public_staff; SELECT COUNT(*) FROM "Patient"; COMMIT;'

verify_rights() {
  expect_denied  'medbase_api without SET ROLE reads Patient' \
    'SELECT COUNT(*) FROM "Patient";' &&
  expect_allowed 'Admissions reads Patient' \
    'BEGIN; SET LOCAL ROLE medbase_admissions; SELECT COUNT(*) FROM "Patient"; COMMIT;' &&
  expect_allowed 'Nurse reads patient names' \
    'BEGIN; SET LOCAL ROLE medbase_nurse; SELECT "PatientID", "FullName" FROM "Patient"; COMMIT;' &&
  expect_allowed 'Head nurse inherits nurse rights' \
    'BEGIN; SET LOCAL ROLE medbase_head_nurse; SELECT "PatientID", "FullName" FROM "Patient"; COMMIT;' &&
  expect_allowed 'PublicStaff reads ward capacity' \
    'BEGIN; SET LOCAL ROLE medbase_public_staff; SELECT COUNT(*) FROM "vw_WardCapacity"; COMMIT;' &&
  expect_denied  'PublicStaff reads Patient' "${PUBLIC_STAFF_READS_PATIENT}"
}

step "1/5 Backup of ${SOURCE_CONTAINER}"
BACKUP_OUTPUT="$(MEDBASE_DB_CONTAINER="${SOURCE_CONTAINER}" bash scripts/backup-db.sh "${TMP_DIR}")"
echo "${BACKUP_OUTPUT}"
BACKUP_FILE="$(sed -n 's/^OK: backup saved to //p' <<<"${BACKUP_OUTPUT}")"
[ -s "${BACKUP_FILE}" ] || fail "backup file not found"
if [ "$(uname -s)" = Linux ]; then
  [ "$(stat -c %a "${BACKUP_FILE}")" = 600 ] || fail "backup file must be readable by its owner only"
fi

step "2/5 Restore into a new PostgreSQL server (${DB_IMAGE}, no roles yet)"
docker rm -f "${CHECK_CONTAINER}" >/dev/null 2>&1 || true
docker run -d --name "${CHECK_CONTAINER}" \
  -e POSTGRES_USER="${DB_USER}" -e POSTGRES_PASSWORD="${DB_USER}" -e POSTGRES_DB=postgres \
  "${DB_IMAGE}" >/dev/null
# TCP check: the temporary server used during init only listens on a socket
for _ in $(seq 1 60); do
  docker exec "${CHECK_CONTAINER}" pg_isready -h 127.0.0.1 -U "${DB_USER}" -d postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec "${CHECK_CONTAINER}" pg_isready -h 127.0.0.1 -U "${DB_USER}" -d postgres >/dev/null \
  || fail "new PostgreSQL server did not start"
MEDBASE_DB_CONTAINER="${CHECK_CONTAINER}" bash scripts/restore-db.sh "${BACKUP_FILE}" "${CHECK_DB}"

step "3/5 Schema, data and roles of the restored database"
verify_schema_and_data || fail "restored database does not match"
echo "  ok: tables, views, data, role memberships"

step "4/5 Access rights after restore"
verify_rights || fail "access rights were not restored"

step "5/5 Negative controls: the checks must catch a broken restore"
psql_owner <<<'DROP VIEW "vw_AlertResponse";'
if verify_schema_and_data 2>/dev/null; then
  fail "schema check passed on a database without vw_AlertResponse"
fi
echo "  ok: missing view is detected"
psql_owner <<<'GRANT SELECT ON "Patient" TO medbase_public_staff;'
if expect_denied 'PublicStaff reads Patient (after a wrong GRANT)' "${PUBLIC_STAFF_READS_PATIENT}" 2>/dev/null; then
  fail "rights check passed although PublicStaff can read Patient"
fi
echo "  ok: wrong GRANT is detected"

echo
echo "OK: backup and restore verified"
