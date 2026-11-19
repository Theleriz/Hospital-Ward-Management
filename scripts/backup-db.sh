#!/usr/bin/env bash
# =============================================================================
# Hospital Ward Management System (Team MedBase)
# Backup of the database with pg_dump (T-44).
# The dump holds patient data and bcrypt hashes of PINs: the file and a new
# backup folder are readable by the current user only (umask 077).
# Cluster roles are not in the dump: scripts/restore-db.sh creates them first.
# Run from the repository root:  bash scripts/backup-db.sh [folder]
# =============================================================================
set -euo pipefail

# Nobody but the current user may read the dump or list the folder
umask 077

CONTAINER_NAME="${MEDBASE_DB_CONTAINER:-medbase-postgres}"
DB_USER="${MEDBASE_DB_USER:-medbase}"
DB_NAME="${MEDBASE_DB_NAME:-hospital_ward}"
BACKUP_DIR="${1:-backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql"

if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
  echo "Контейнер ${CONTAINER_NAME} не запущен. Запускаю сервис db..."
  docker compose up -d --wait db
fi

mkdir -p "${BACKUP_DIR}"

# A failed pg_dump must not leave a half-written file that looks like a backup
if ! docker exec "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" > "${BACKUP_FILE}"; then
  rm -f "${BACKUP_FILE}"
  echo "ERROR: pg_dump завершился с ошибкой" >&2
  exit 1
fi

if [ ! -s "${BACKUP_FILE}" ]; then
  rm -f "${BACKUP_FILE}"
  echo "ERROR: файл бэкапа пустой: ${BACKUP_FILE}" >&2
  exit 1
fi

echo "OK: backup saved to ${BACKUP_FILE}"
