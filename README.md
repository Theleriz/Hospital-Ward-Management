# Hospital Ward Management — Team MedBase

База данных PostgreSQL для Task 09 (госпитализация пациента в палату) и Lab 04 / Task 07 (оповещения медсестёр).

## Команда

| Student ID | Участник | GitHub | Роль |
|---|---|---|---|
| 24B031778 | Zhanserikuly Nurali | [Nurali-Zhanserik](https://github.com/Nurali-Zhanserik) | Data & Database |
| 24B031691 | Bauyrzhanuly Kuanyshbek | [Kuanyshbek06](https://github.com/Kuanyshbek06) | Systems Analysis & Requirements |
| 24B032123 | Shynbulat Kazbek | [Kazbekio](https://github.com/Kazbekio) | Architecture & Security |
| 24B032104 | Chinaliyev Baigel | [Ba1igel](https://github.com/Ba1igel) | Acceptance Criteria & Testing |
| 24B031775 | Rishat Zhanat | [TheLeriz](https://github.com/Theleriz) | **Lead проекта**, Application & Development |

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
│   ├── 02_procedures.sql       # госпитализация, выписка, оповещения (создание, эскалация, подтверждение)
│   ├── 03_security.sql         # представление vw_WardCapacity, роли и права
│   ├── 04_seed.sql             # тестовые данные (очищает таблицы и заполняет заново)
│   ├── 05_queries.sql          # бизнес-запросы (только чтение)
│   ├── demo.sql                # пошаговое демо для презентации
│   ├── docker/init.sql         # точка входа для Docker
│   └── tests/
│       └── test_hospital_ward.sql   # автотесты, всё откатывается в конце
├── docs/
│   ├── decisions.md            # журнал критических решений по проекту (с шаблоном записи)
│   └── works/                  # работы участников, у каждого своя папка
│       └── <Фамилия>_<Имя>/    #   например Zhanat_Rishat/24B031775_Zhanat_Rishat_Task2.docx
├── scripts/
│   └── check-db.sh             # проверка «main готова к демо» (локально и в CI)
├── .github/
│   ├── workflows/db.yml        # CI: запускает scripts/check-db.sh на каждый PR и push в main
│   └── pull_request_template.md     # чек-лист для каждого PR
├── CONTRIBUTING.md             # правила работы с репозиторием
└── README.md
```

## Документы

- **[docs/works/](docs/works/)** — работы всех участников. У каждого своя папка `<Фамилия>_<Имя>`, файлы называются `<StudentID>_<Фамилия>_<Имя>_Task<N>.docx`.
- **[docs/decisions.md](docs/decisions.md)** — журнал критических решений по проекту: смена технологии, способ работы с чем-то важным и т. п. Мелкие решения, которые не влияют на проект, туда не пишутся. Шаблон записи — в начале файла.

Документы добавляются так же, как код: через ветку от свежей `main` и PR. Подробнее — в [CONTRIBUTING.md](CONTRIBUTING.md#документы).

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
6. перевод между палатами с автоматическим закрытием старой госпитализации, затем выписка;
7. транзакция: регистрация вместе с госпитализацией и откат при полной палате;
8. оповещения (Lab 04): новое оповещение от монитора, эскалация через 30 с на свободную медсестру, подтверждение, журнал событий и время реакции;
9. роли: что может обычный персонал, приёмное отделение и медсёстры.

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

# Автотесты (124 проверки, в конце "ALL TESTS PASSED", данные не меняются)
docker exec medbase-postgres psql -U medbase -d hospital_ward -v ON_ERROR_STOP=1 -f /db/tests/test_hospital_ward.sql

# Остановить / удалить контейнер вместе с данными
docker compose stop
docker compose down -v
```

Тесты рассчитаны на состояние после `04_seed.sql`.

## Что реализовано (база данных v2)

База — второй, независимый слой защиты: даже если backend ошибётся, процедуры, ограничения и права не дадут записать некорректные данные ([decisions.md](docs/decisions.md), запись 5).

**Коечный фонд (Task 09)**

- **Таблицы:** `Patient`, `Ward`, `Admission` (связующая M:N).
- **Правила:** `Capacity > 0`, `WardType` — только из списка, `DOB` обязательна, `Phone` уникален, `Status` — только `Active` / `Discharged`, у закрытой госпитализации есть `DischargeDate` не раньше `AdmitDate`.
- **Внешние ключи** `ON DELETE RESTRICT`: нельзя удалить пациента или палату, у которых есть история госпитализаций.
- **Один активный приём на пациента** — уникальный индекс `UX_Admission_OneActivePerPatient`.
- **`sp_AdmitPatient(patient, ward)`** — госпитализация с проверкой вместимости. Если пациент уже лежит в другой палате, это перевод: старая госпитализация закрывается (`Discharged`). Строки палаты и пациента блокируются, поэтому две параллельные госпитализации не займут одну последнюю койку.
- **`sp_RegisterAndAdmitPatient(name, dob, phone, gender, ward)`** — транзакция: регистрация пациента (если его нет, поиск по телефону) + госпитализация. Если палата заполнена, регистрация откатывается.
- **`sp_DischargePatient(patient)`** — выписка: закрывает активную госпитализацию.

**Оповещения медсёстрам (Lab 04 — Task 07, [decisions.md](docs/decisions.md), запись 1)**

- **Таблицы:** `Nurse` (бейдж, PIN только в виде bcrypt-хэша, статус `Available` / `Busy` / `OffShift`), `NurseAssignment` (кто работает в какой палате, одна основная медсестра на палату), `WardAlert`, `AlertEvent`.
- **`WardAlert`** хранит отдельно назначенную медсестру, медсестру эскалации и подтвердившую медсестру, а также время создания, эскалации и подтверждения. По ним считается время реакции. Ограничения не дают сохранить несогласованное оповещение (подтверждено без медсестры, эскалирован `LOW` и т. п.).
- **`AlertEvent`** — журнал событий (`CREATED`, `ASSIGNED`, `ESCALATED`, `ACKNOWLEDGED`). Его заполняет триггер на `WardAlert`, а изменить или удалить запись нельзя даже владельцу базы.
- **`sp_RaiseAlert(ward, patient, source, priority, description, nurse, NULL)`** — создаёт оповещение и возвращает его номер (`ALT-…`). Проверяет, что пациент лежит в этой палате, а медсестра работает в ней и на смене.
- **`sp_EscalateAlert(alert, nurse)`** — эскалация: только `PENDING` с приоритетом `HIGH` / `CRITICAL`, не раньше чем через 30 с, только на медсестру со статусом `Available`.
- **`sp_AcknowledgeAlert(alert, nurse)`** — подтверждение: назначенной медсестрой, медсестрой эскалации или медсестрой этой палаты. Назначенная медсестра при этом не затирается.
- **`sp_SetNurseStatus(nurse, status)`** — смена статуса медсестры.
- **Тестовые медсёстры и их PIN** перечислены в начале [db/04_seed.sql](db/04_seed.sql).

**Роли**

- `medbase_admissions` (врачи и приёмное отделение) — пациенты, госпитализации, выписка.
- `medbase_public_staff` — только `vw_WardCapacity` (занятость палат без данных пациентов).
- `medbase_nurse` — читает оповещения и журнал, подтверждает оповещения, меняет свой статус.
- `medbase_alert_service` (фоновая эскалация и симулятор устройств) — создаёт и эскалирует оповещения.
- Процедуры закрыты от `PUBLIC`. Писать в `WardAlert` и `AlertEvent` напрямую не может ни одна роль, а хэши PIN никто, кроме владельца базы, не читает.

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
