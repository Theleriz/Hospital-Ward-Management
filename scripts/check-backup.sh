#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${MEDBASE_DB_CONTAINER:-medbase-postgres}"
DB_USER="${MEDBASE_DB_USER:-medbase}"
TEST_DB="hospital_ward_backup_check"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${TMP_DIR}"
  if docker ps --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
    docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -c \
      "DROP DATABASE IF EXISTS \"${TEST_DB}\";" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "1/3 Creating backup..."
BACKUP_OUTPUT="$(bash scripts/backup-db.sh "${TMP_DIR}")"
echo "${BACKUP_OUTPUT}"
BACKUP_FILE="$(echo "${BACKUP_OUTPUT}" | sed -n 's/^OK: backup saved to //p')"

echo "2/3 Restoring into temporary database ${TEST_DB}..."
bash scripts/restore-db.sh "${BACKUP_FILE}" "${TEST_DB}"

echo "3/3 Verifying restored schema, data, and constraints..."
docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${TEST_DB}" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
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
END;
$$;
SQL

echo "OK: backup and restore verified"