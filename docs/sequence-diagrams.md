# Sequence diagrams: что делает Hospital Ward Management

Автор: Shynbulat Kazbek (24B032123, Kazbekio), Architecture & Security.

Срез: `main` от 12 ноября 2026, базовый коммит `a8ffc3f` (UC-1 — UC-7).

Каждая вертикальная линия — участник процесса. Стрелки читаются сверху вниз:
вызов → проверка → изменение данных → ответ. `alt` показывает варианты,
`loop` — повторение. nginx передаёт `/api` в FastAPI без изменения бизнес-логики;
он опущен на диаграммах ради читаемости. SQL-процедуры показаны внутри БД.

Открыть диаграммы можно прямо на GitHub. В VS Code открыть Markdown Preview
(`Ctrl+Shift+V`); если установленная версия preview не рисует Mermaid, показать
этот файл на GitHub. Исходный текст диаграмм хранится вместе с кодом и
обновляется при изменении сценария.

## 1. Вход и разрешение на действие

Реализовано: `backend/app/routers/auth.py`, `auth.py`, `db.py`,
`db/02_procedures.sql`, `db/03_security.sql`.

```mermaid
sequenceDiagram
    autonumber
    actor Staff as Сотрудник
    participant UI as React
    participant API as FastAPI
    participant DB as PostgreSQL
    Staff->>UI: Вводит бейдж и PIN
    UI->>API: POST /api/auth/login
    API->>API: Формат ввода и блокировка попыток
    alt Бейдж заблокирован
        API-->>UI: 429 и Retry-After
    else Проверка входа разрешена
        API->>DB: fn_AuthenticateStaff(badge, pin)
        DB->>DB: crypt(PIN, PinHash), сравнение bcrypt
        alt Неверный PIN или неизвестный бейдж
            DB-->>API: Нет строк
            API->>API: Записать неудачную попытку
            API-->>UI: 401, одинаковое сообщение
        else Вход успешен
            DB-->>API: account_id, имя, роль
            API-->>UI: 200 и подписанная HttpOnly-cookie
        end
    end
    Staff->>UI: Открывает защищённый раздел
    UI->>API: Запрос с session cookie
    alt Нет действительной сессии
        API-->>UI: 401 Требуется вход
    else Роль не разрешена
        API-->>UI: 403 Недостаточно прав
    else Роль разрешена
        API->>DB: BEGIN и SET LOCAL ROLE из DB_ROLES
        API->>DB: Запрос с правами пользователя
        DB->>DB: Проверка GRANT и правил процедуры
        DB-->>API: Результат или отказ
        API->>DB: COMMIT или ROLLBACK, сброс LOCAL ROLE
        API-->>UI: Безопасный результат
    end
```

**Что доказываем:** личность проверяется при входе; роль — при каждом
защищённом действии. Подписанная cookie защищает целостность, но не шифрует
содержимое. `HttpOnly` закрывает доступ из JavaScript страницы; владелец
браузера всё ещё может посмотреть свою cookie в инструментах разработчика.

## 2. Регистрация и госпитализация пациента (UC-1)

Реализовано: `backend/app/routers/admissions.py`, `db/02_procedures.sql`.
Требования FR-01 — FR-04.

```mermaid
sequenceDiagram
    autonumber
    actor Clerk as Приёмное отделение
    participant UI as AdmissionsPage
    participant API as FastAPI admissions
    participant DB as PostgreSQL
    Clerk->>UI: Вводит пациента и выбирает палату
    UI->>API: POST /api/admissions
    API->>API: Сессия, Admissions, формат данных, DOB
    API->>DB: BEGIN и SET LOCAL ROLE medbase_admissions
    API->>DB: Проверить палату, места и телефон пациента
    alt Палаты нет, мест нет или пациент уже госпитализирован
        API->>DB: ROLLBACK
        API-->>UI: 404 или 409, данные сохранены
    else Предварительные проверки пройдены
        API->>DB: CALL sp_RegisterAndAdmitPatient(...)
        DB->>DB: Найти по телефону или INSERT Patient
        DB->>DB: sp_AdmitPatient, блокировка пациента и палаты
        DB->>DB: Повторно проверить вместимость и активный приём
        alt Место заняли параллельно или нарушено правило
            DB-->>API: Исключение процедуры
            API->>DB: ROLLBACK регистрации и госпитализации
            API-->>UI: 409, незавершённая регистрация не остаётся
        else Запись разрешена
            DB->>DB: INSERT Admission со статусом Active
            DB-->>API: Данные активной госпитализации
            API->>DB: COMMIT
            API-->>UI: 201 Created
            UI-->>Clerk: Пациент в списке, занятость обновлена
        end
    end
```

**Что доказываем:** новый пациент и его госпитализация сохраняются одной
транзакцией. Проверка свободных мест повторяется после блокировки строки,
чтобы два запроса не заняли последнюю койку одновременно.

## 3. Перевод в другую палату (UC-2)

Реализовано: `admissions.transfer`, `sp_AdmitPatient`. FR-05 — FR-07.

```mermaid
sequenceDiagram
    autonumber
    actor Clerk as Приёмное отделение
    participant UI as AdmissionsPage
    participant API as FastAPI admissions
    participant DB as PostgreSQL
    Clerk->>UI: Выбирает пациента и новую палату
    UI->>API: POST /api/admissions/{patient_id}/transfer
    API->>API: Сессия и роль Admissions
    API->>DB: BEGIN и SET LOCAL ROLE medbase_admissions
    API->>DB: Текущий приём и места в новой палате
    alt Нет активного приёма, та же палата или нет мест
        API->>DB: ROLLBACK
        API-->>UI: 404 или 409, прежняя палата сохранена
    else Перевод допустим
        API->>DB: CALL sp_AdmitPatient(patient_id, ward_id)
        DB->>DB: Блокировка пациента и новой палаты, повторные проверки
        DB->>DB: Старый Admission = Discharged, DischargeDate
        DB->>DB: Новый Admission = Active
        alt Ошибка во время процедуры
            API->>DB: ROLLBACK обоих изменений
            API-->>UI: 409, пациент остаётся в прежней палате
        else Успех
            DB-->>API: Новая активная госпитализация
            API->>DB: COMMIT
            API-->>UI: 200, новая палата
            UI-->>Clerk: Список и занятость двух палат обновлены
        end
    end
```

**Что доказываем:** перевод сохраняет историю. Он не меняет номер палаты в
старой записи, а закрывает старую госпитализацию и создаёт новую атомарно.

## 4. Выписка и табло занятости (UC-3, UC-4)

Реализовано: `admissions.discharge`, `wards.list_wards`,
`sp_DischargePatient`, `vw_WardCapacity`. FR-08 — FR-13, NFR-03.

```mermaid
sequenceDiagram
    autonumber
    actor Clerk as Приёмное отделение
    actor Staff as Прочий персонал
    participant UI as React
    participant API as FastAPI
    participant DB as PostgreSQL
    Clerk->>UI: Подтверждает выписку
    UI->>API: POST /api/admissions/{patient_id}/discharge
    API->>API: Проверка Admissions
    API->>DB: BEGIN и SET LOCAL ROLE medbase_admissions
    API->>DB: Проверить активный приём
    alt Активного приёма нет
        API->>DB: ROLLBACK
        API-->>UI: 404
    else Есть активный приём
        API->>DB: CALL sp_DischargePatient(patient_id)
        DB->>DB: Блокировки, Discharged и DischargeDate
        API->>DB: COMMIT
        API-->>UI: 204 No Content
    end
    Staff->>UI: Открывает табло палат
    loop Обновление табло каждые 10 секунд
        UI->>API: GET /api/wards
        API->>DB: SET LOCAL ROLE medbase_public_staff внутри транзакции
        API->>DB: SELECT из vw_WardCapacity
        DB->>DB: Свободно = Capacity минус Active admissions
        DB-->>API: Только поля палат и количество мест
        API-->>UI: 200, без имён и телефонов пациентов
    end
```

**Что доказываем:** выписанный пациент остаётся в истории, но освобождает
место. Табло считает только активные госпитализации и не раскрывает пациентов.

## 5. Вызов медсестры и подтверждение (UC-5, UC-6)

Реализовано: `routers/simulator.py`, `routers/alerts.py`, `SimulatorPage.tsx`,
`NursePost.tsx`, `sp_RaiseAlert`, `sp_AcknowledgeAlert` и триггер журнала.
FR-14 — FR-22; целевое время показа NFR-01 — не более 2 секунд.

```mermaid
sequenceDiagram
    autonumber
    actor Operator as Оператор демо
    actor Nurse as Медсестра
    participant Sim as Симулятор в React
    participant Post as NursePost
    participant API as FastAPI
    participant DB as PostgreSQL
    Operator->>Sim: Создаёт сигнал MONITOR или CALL_BUTTON
    Sim->>API: POST /api/simulator/alerts
    API->>API: Симулятор включён, роль Nurse или HeadNurse
    API->>DB: SET LOCAL ROLE medbase_alert_service в транзакции
    API->>DB: Проверить палату, пациента, выбрать медсестру на смене
    API->>DB: CALL sp_RaiseAlert(...)
    DB->>DB: Повторные проверки, INSERT WardAlert = PENDING
    DB->>DB: Триггер добавляет CREATED и ASSIGNED, если назначена
    API->>DB: COMMIT
    API-->>Sim: 201 и alert_id
    loop Каждую секунду
        Post->>API: GET /api/alerts с cookie медсестры
        API->>DB: Читать под medbase_nurse и отфильтровать доступные палаты
        DB-->>API: Список по приоритету и возрасту
        API-->>Post: 200, open и recent
    end
    Post-->>Nurse: Карточка и звук для нового HIGH или CRITICAL
    Nurse->>Post: Нажимает Подтвердить
    Post->>API: POST /api/alerts/{id}/acknowledge
    API->>API: Сессия, роль, смена, назначение или своя палата
    alt Чужое оповещение
        API-->>Post: 403, данные не изменились
    else Медсестра имеет право
        API->>DB: CALL sp_AcknowledgeAlert(id, ID из сессии)
        DB->>DB: Блокировка и повторная проверка допуска
        DB->>DB: ACKNOWLEDGED, кто и когда, триггер ACKNOWLEDGED
        API->>DB: COMMIT
        API-->>Post: 200, подтверждённое оповещение
        Post-->>Nurse: Переместить карточку в подтверждённые
    end
```

**Что доказываем:** в текущем MVP сигнал создаёт симулятор. Реальные мониторы
и доставка на физические устройства не подключены. Пост использует HTTP-опрос
раз в секунду; SSE здесь пока нет. Сам интервал опроса не доказывает NFR-01:
время до отрисовки и звука нужно отдельно измерять браузерным e2e-тестом.

## 6. Эскалация неподтверждённого сигнала (UC-7)

Реализовано: `backend/app/escalation.py`, `sp_EscalateAlert`.
FR-24 — FR-27; NFR-02 задаёт 30 секунд и допуск до 35 секунд при проверке.

```mermaid
sequenceDiagram
    autonumber
    participant Worker as EscalationWorker
    participant DB as PostgreSQL
    participant API as FastAPI alerts
    participant Post as Пост другой медсестры
    loop Каждые примерно 2 секунды
        Worker->>DB: BEGIN, SET LOCAL ROLE medbase_alert_service
        Worker->>DB: PENDING, HIGH или CRITICAL, возраст от 30 секунд
        DB-->>Worker: Просроченные оповещения
        loop Каждое просроченное оповещение
            Worker->>DB: Найти Available, не исходную, сначала из той же палаты
            alt Свободной медсестры нет
                Worker->>Worker: Записать предупреждение, повторить в следующем цикле
            else Найден получатель
                Worker->>DB: SAVEPOINT, CALL sp_EscalateAlert(id, nurse)
                DB->>DB: FOR UPDATE, ещё раз проверить статус, возраст и Available
                alt Уже подтверждено или другое правило нарушено
                    DB-->>Worker: Отказ процедуры
                    Worker->>DB: ROLLBACK к SAVEPOINT
                else Эскалация разрешена
                    DB->>DB: ESCALATED, получатель и время
                    DB->>DB: Триггер добавляет ESCALATED в журнал
                    DB-->>Worker: Успех
                end
            end
        end
        Worker->>DB: COMMIT
    end
    Post->>API: GET /api/alerts, опрос раз в секунду
    API->>DB: Получить назначенные и эскалированные на пользователя
    API-->>Post: Карточка с отметкой эскалации
```

**Что доказываем:** LOW не эскалируется. Повторная проверка под блокировкой
защищает от гонки между подтверждением и эскалацией. Если нет Available,
доставку в пределах 35 секунд гарантировать нельзя: система повторяет поиск.

## 7. Связь диаграмм с проверками и направлением разработки

| Сценарий | Существующие проверки | Новый вклад Architecture & Security |
|---|---|---|
| Вход и права | `tests/test_auth.py` | Матрица реальных API: Anonymous и все 4 роли |
| UC-1 — UC-3 | `tests/test_admissions.py`, SQL-тесты процедур | Запрет чтения, госпитализации, перевода и выписки чужим ролям; отсутствие изменений при отказе |
| UC-4 | `tests/test_admissions.py` | Точный список полей табло без персональных данных |
| UC-5, UC-6 | `tests/test_alerts.py` | Доступ к симулятору и посту; чужая палата; выключенный симулятор |
| UC-7 | `tests/test_alerts.py`, SQL-тесты | Схема worker и повторных проверок; непрерывная безопасность ролей пула |
| UC-8 | В `main` пока отсутствует | Отчёт старшей медсестры находится в PR #12; API отчёта здесь не заявлен проверенным |

Реализация движется к согласованным двум процессам: UC-1 — UC-7 уже связаны
API и UI, UC-8 находится в отдельной разработке. Диаграммы помогают проверить,
что новый код сохраняет транзакции, историю и оба слоя контроля доступа.
Зелёные тесты прав подтверждают этот аспект, но не заменяют приёмку всех
сценариев, измерение задержек, тест звука и полную проверку безопасности.

Отчёт по новой проверке: [testing/api-permissions-report.md](testing/api-permissions-report.md).
