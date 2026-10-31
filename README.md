# Hospital Ward Management — Team MedBase

База данных PostgreSQL для Task 09 (госпитализация пациента в палату) и Lab 04 / Task 07 (оповещения медсестёр).

## Правила работы с репозиторием

Подробно с командами: [CONTRIBUTING.md](CONTRIBUTING.md).

1. **Ветка `main` всегда готова к демо.** В любой момент из `main` можно показать корректно работающий проект: база собирается с нуля, автотесты проходят, `db/demo.sql` отрабатывает до конца. Всё это проверяет одна команда `bash scripts/check-db.sh`, и та же проверка автоматически запускается в CI на каждый PR. Незаконченная работа в `main` не попадает.
2. **Все изменения — через Pull Request (PR).** Прямой push в `main` запрещён, PR сливается только при зелёной проверке CI `db-check`. Сливать PR в `main` и пушить в неё напрямую может только `theleriz` (zanatrisat54@gmail.com). Это закреплено правилами ветки на GitHub.
3. **Начинать работу от свежей `main`.** Перед новой функциональностью или новым документом обновите `main` и создайте ветку от неё, чтобы не было рассинхрона:

   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/<название>
   ```

## Структура

```
BIS/
├── docker-compose.yml          # Postgres 17, создаёт и заполняет БД при первом запуске
├── db/
│   ├── setup.sql               # полная установка: 01 → 02 → 03 → 04 (можно перезапускать)
│   ├── 01_schema.sql           # таблицы, ключи, CHECK, индексы
│   ├── 02_procedures.sql       # sp_AdmitPatient, sp_RegisterAndAdmitPatient, sp_AcknowledgeAlert
│   ├── 03_security.sql         # представление vw_WardCapacity, роли и права
│   ├── 04_seed.sql             # тестовые данные (очищает таблицы и заполняет заново)
│   ├── 05_queries.sql          # бизнес-запросы (только чтение)
│   ├── demo.sql                # пошаговое демо для презентации
│   ├── docker/init.sql         # точка входа для Docker
│   └── tests/
│       └── test_hospital_ward.sql   # автотесты, всё откатывается в конце
├── scripts/
│   └── check-db.sh             # проверка «main готова к демо» (локально и в CI)
├── .github/
│   ├── workflows/db.yml        # CI: запускает scripts/check-db.sh на каждый PR и push в main
│   └── pull_request_template.md     # чек-лист для каждого PR
├── CONTRIBUTING.md             # правила работы с репозиторием
└── README.md
```

## Запуск

```bash
docker compose up -d --wait
```

При первом запуске (пустой volume) контейнер сам выполнит `db/setup.sql`.

| Параметр | Значение |
|---|---|
| Хост / порт | `localhost:55440` |
| База | `hospital_ward` |
| Пользователь / пароль | `medbase` / `medbase` |
| Контейнер | `medbase-postgres` |

Папка `db/` смонтирована в контейнер как `/db`, поэтому скрипты запускаются прямо оттуда.

## Доступ к БД из терминала

Через psql внутри контейнера (ничего ставить не нужно):

```bash
docker exec -it medbase-postgres psql -U medbase -d hospital_ward
```

Через psql, установленный на компьютере:

```bash
psql "postgresql://medbase:medbase@localhost:55440/hospital_ward"
```

Полезные команды внутри psql:

| Команда | Что делает |
|---|---|
| `\dt` | список таблиц |
| `\d "Patient"` | структура таблицы |
| `\df` | процедуры и функции |
| `\dv` | представления |
| `\du` | роли |
| `\x` | вертикальный вывод (для широких строк) |
| `\i /db/05_queries.sql` | выполнить файл |
| `\q` | выход |

**Важно:** таблицы и колонки созданы в кавычках, поэтому писать их нужно тоже в кавычках и с тем же регистром:

```sql
SELECT "FullName" FROM "Patient";   -- работает
SELECT FullName FROM Patient;       -- ошибка: relation "patient" does not exist
```

Для GUI-клиентов (DBeaver, DataGrip, pgAdmin) используйте те же параметры из таблицы выше.

## Демо для презентации

```bash
docker exec -it medbase-postgres psql -U medbase -d hospital_ward -f /db/demo.sql
```

Перед стартом демо перезаливает тестовые данные, затем идёт по шагам и ждёт Enter после каждого:

1. таблицы и количество строк;
2. бизнес-запрос «кто сейчас лежит и где» и занятость палат;
3. главное действие: госпитализация;
4. правила процедуры: полная палата, повторная госпитализация, несуществующий пациент;
5. ограничения: `Capacity > 0`, допустимые `Status`, FK, `ON DELETE RESTRICT`, один активный приём;
6. перевод между палатами с автоматическим закрытием старой госпитализации;
7. транзакция: регистрация вместе с госпитализацией и откат при полной палате;
8. подтверждение оповещения медсестрой (Lab 04);
9. роли: что видит обычный персонал, а что приёмное отделение.

Ошибки (`ERROR`) в демо ожидаемые: они показывают, что правила работают. Демо можно запускать повторно.

## CI

Workflow [`.github/workflows/db.yml`](.github/workflows/db.yml) (проверка `db-check`) запускается на каждый PR в `main`, на каждый push в `main` и вручную (Actions → DB CI → Run workflow). Он выполняет `scripts/check-db.sh`:

1. собирает базу с нуля через `docker compose` (пустой volume);
2. запускает автотесты;
3. прогоняет `db/demo.sql` до конца: ожидаемые ошибки демо допустимы, а сломанный SQL (`syntax error`, `relation ... does not exist` и т. п.) — нет;
4. выполняет `db/05_queries.sql`, повторно запускает `db/setup.sql` и ещё раз тесты.

Ту же проверку можно запустить у себя перед открытием PR (в Git Bash на Windows):

```bash
bash scripts/check-db.sh
```

**Внимание:** скрипт пересоздаёт локальную базу (`docker compose down -v`), поэтому данные, введённые вручную, пропадут.

Пока CI проверяет только базу данных. Проверки для новых компонентов добавляются по решению `theleriz`.

## Типовые действия

```bash
# Пересоздать схему и данные заново
docker exec medbase-postgres psql -U medbase -d hospital_ward -f /db/setup.sql

# Только перезалить тестовые данные
docker exec medbase-postgres psql -U medbase -d hospital_ward -f /db/04_seed.sql

# Бизнес-запросы
docker exec medbase-postgres psql -U medbase -d hospital_ward -f /db/05_queries.sql

# Автотесты (43 проверки, в конце "ALL TESTS PASSED", данные не меняются)
docker exec medbase-postgres psql -U medbase -d hospital_ward -v ON_ERROR_STOP=1 -f /db/tests/test_hospital_ward.sql

# Остановить / удалить контейнер вместе с данными
docker compose stop
docker compose down -v
```

Тесты рассчитаны на состояние после `04_seed.sql`.

## Что реализовано (по документу Task 09)

- **Таблицы:** `Patient`, `Ward`, `Admission` (связующая M:N), плюс `WardAlert` для Lab 04.
- **Правила:** `Capacity > 0`, `WardType` и `DOB` обязательны, `Phone` уникален, `Status` — только `Active` / `Discharged`, `AdmitDate` — `DATE`.
- **Внешние ключи** `ON DELETE RESTRICT`: нельзя удалить пациента или палату, у которых есть история госпитализаций.
- **Один активный приём на пациента** — уникальный индекс `UX_Admission_OneActivePerPatient`.
- **`sp_AdmitPatient(patient, ward)`** — госпитализация с проверкой вместимости. Если пациент уже лежит в другой палате, это перевод: старая госпитализация закрывается (`Discharged`). Строки палаты и пациента блокируются, поэтому две параллельные госпитализации не займут одну последнюю койку.
- **`sp_RegisterAndAdmitPatient(name, dob, phone, gender, ward)`** — транзакция: регистрация пациента (если его нет, поиск по телефону) + госпитализация. Если палата заполнена, регистрация откатывается.
- **`sp_AcknowledgeAlert(alert, nurse)`** — подтверждение оповещения медсестрой.
- **Роли:** `medbase_admissions` (врачи и приёмное отделение) — работа с пациентами и госпитализациями; `medbase_public_staff` — только `vw_WardCapacity` (занятость палат без данных пациентов).

## Ручная проверка параллельной госпитализации

Автотест не может открыть две сессии, поэтому проверка вручную в двух терминалах.
После `04_seed.sql` в палате 101 нет свободных мест, а в палате 103 свободны 3 места. Займите два из них, чтобы осталось одно:

```sql
-- Терминал 1
CALL sp_AdmitPatient(5, 103);
CALL sp_AdmitPatient(6, 103);
BEGIN;
CALL sp_AdmitPatient(7, 103);   -- последнее место, транзакция пока открыта

-- Терминал 2 (зависнет, ожидая терминал 1)
CALL sp_AdmitPatient(8, 103);

-- Терминал 1
COMMIT;
-- Терминал 2 получит: ERROR: Ward ID 103 is full (Capacity: 3, Occupied: 3).
```

После проверки верните данные: `\i /db/04_seed.sql`.
