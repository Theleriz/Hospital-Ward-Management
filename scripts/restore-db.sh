#!/usr/bin/env bash
# =============================================================================
# Hospital Ward Management System (Team MedBase)
# Restore the database from a pg_dump file made by scripts/backup-db.sh (T-44).
# WARNING: drops and recreates the target database.
# Precondition for a new server: the cluster roles (medbase_api, medbase_nurse,
# ...) are not in the dump, so they are created first from db/00_roles.sql.
# Otherwise the dump's GRANTs fail and the access rights are not restored.
# Run from the repository root:
#   bash scripts/restore-db.sh <файл.sql> [имя_базы]
# =============================================================================
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Использование: bash scripts/restore-db.sh <путь_к_файлу.sql> [имя_базы]" >&2
  exit 1
fi

BACKUP_FILE="$1"
TARGET_DB="${2:-${MEDBASE_DB_NAME:-hospital_ward}}"
CONTAINER_NAME="${MEDBASE_DB_CONTAINER:-medbase-postgres}"
DB_USER="${MEDBASE_DB_USER:-medbase}"
ROLES_FILE="$(dirname "$0")/../db/00_roles.sql"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "ERROR: файл бэкапа не найден: ${BACKUP_FILE}" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
  echo "Контейнер ${CONTAINER_NAME} не запущен. Запускаю сервис db..."
  docker compose up -d --wait db
fi

PSQL_ADMIN=(docker exec -i -e PGOPTIONS=--client-min-messages=warning "${CONTAINER_NAME}"
            psql -U "${DB_USER}" -d postgres -v ON_ERROR_STOP=1 -q)

# 1. Cluster roles and memberships (re-runnable; a no-op on the same server)
"${PSQL_ADMIN[@]}" < "${ROLES_FILE}" >/dev/null

# 2. Recreate the target database: close its sessions first
"${PSQL_ADMIN[@]}" -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TARGET_DB}' AND pid <> pg_backend_pid();" >/dev/null </dev/null
"${PSQL_ADMIN[@]}" -c "DROP DATABASE IF EXISTS \"${TARGET_DB}\";" >/dev/null </dev/null
"${PSQL_ADMIN[@]}" -c "CREATE DATABASE \"${TARGET_DB}\" OWNER \"${DB_USER}\";" >/dev/null </dev/null

# 3. Data, schema and the GRANTs on tables, views and routines
docker exec -i -e PGOPTIONS=--client-min-messages=warning "${CONTAINER_NAME}" \
  psql -U "${DB_USER}" -d "${TARGET_DB}" -v ON_ERROR_STOP=1 -q < "${BACKUP_FILE}" >/dev/null

echo "OK: database ${TARGET_DB} restored from ${BACKUP_FILE}"
