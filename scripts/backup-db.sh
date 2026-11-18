#!/usr/bin/env bash
set -euo pipefail

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

docker exec "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" > "${BACKUP_FILE}"

if [ ! -s "${BACKUP_FILE}" ]; then
  echo "ERROR: файл бэкапа пустой: ${BACKUP_FILE}" >&2
  exit 1
fi

echo "OK: backup saved to ${BACKUP_FILE}"