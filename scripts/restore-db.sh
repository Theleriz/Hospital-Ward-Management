#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Использование: bash scripts/restore-db.sh <путь_к_файлу.sql> [имя_базы]" >&2
  exit 1
fi

BACKUP_FILE="$1"
TARGET_DB="${2:-${MEDBASE_DB_NAME:-hospital_ward}}"
CONTAINER_NAME="${MEDBASE_DB_CONTAINER:-medbase-postgres}"
DB_USER="${MEDBASE_DB_USER:-medbase}"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "ERROR: файл бэкапа не найден: ${BACKUP_FILE}" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
  echo "Контейнер ${CONTAINER_NAME} не запущен. Запускаю сервис db..."
  docker compose up -d --wait db
fi

# Завершаем активные сессии к целевой БД перед пересозданием
docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TARGET_DB}' AND pid <> pg_backend_pid();" >/dev/null

docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -v ON_ERROR_STOP=1 -c \
  "DROP DATABASE IF EXISTS \"${TARGET_DB}\";" >/dev/null

docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d postgres -v ON_ERROR_STOP=1 -c \
  "CREATE DATABASE \"${TARGET_DB}\" OWNER \"${DB_USER}\";" >/dev/null

docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${TARGET_DB}" -v ON_ERROR_STOP=1 < "${BACKUP_FILE}" >/dev/null

echo "OK: database ${TARGET_DB} restored from ${BACKUP_FILE}"