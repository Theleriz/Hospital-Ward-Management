# Sequence diagrams: что делает Hospital Ward Management

Автор: Shynbulat Kazbek (24B032123, Kazbekio), Architecture & Security.

Срез: `main df13eba` от 26 ноября 2026. Первые диаграммы UC-1 — UC-8
созданы на версии от 18 ноября. T-59 обновляет эскалацию и добавляет новые потоки.

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
`db/06_login_security.sql`, `db/07_badges.sql`. Сканирование и перевыпуск показаны отдельно в разделе 10.

```mermaid
sequenceDiagram
    autonumber
    actor Staff as Сотрудник
    participant UI as React
    participant API as FastAPI
    participant DB as PostgreSQL
    Staff->>UI: Вводит бейдж и PIN
    UI->>API: POST /api/auth/login
    API->>API: Проверить формат ввода
    API->>DB: BEGIN, fn_LoginStaff(badge, pin)
    DB->>DB: INSERT при необходимости, SELECT FOR UPDATE по бейджу
    DB->>DB: Проверить срок блокировки по часам PostgreSQL
    alt Бейдж заблокирован
        DB-->>API: LOCKED и RetryAfter
        API->>DB: COMMIT
        API-->>UI: 429 и Retry-After
    else Проверка входа разрешена
        DB->>DB: Приватный fn_AuthenticateStaff(badge, pin)
        DB->>DB: crypt(PIN, PinHash), сравнение bcrypt
        alt Неверный PIN или неизвестный бейдж
            DB->>DB: Сохранить ошибку, на пятой поставить LockedUntil
            DB-->>API: INVALID
            API->>DB: COMMIT до возврата HTTP-ошибки
            API-->>UI: 401, одинаковое сообщение
        else Вход успешен
            DB->>DB: Сбросить счётчик ошибок
            DB-->>API: OK, account_id, имя, роль
            API->>DB: COMMIT
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
        API->>DB: Читать под medbase_nurse (старшая — medbase_head_nurse), отфильтровать палаты
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
        Worker->>DB: HIGH/CRITICAL: PENDING от 30 с или ESCALATED от 30 с с прошлой эскалации
        DB-->>Worker: Просроченные оповещения
        loop Каждое просроченное оповещение
            Worker->>DB: Исключить OffShift, назначенную и всех ранее вызванных
            Worker->>DB: Ранжировать Available, затем Busy по роли, палате, этажу и загрузке
            alt Нет подходящей медсестры на смене
                Worker->>Worker: Сохранить состояние, записать предупреждение
            else Найден получатель
                Worker->>DB: SAVEPOINT, CALL sp_EscalateAlert(id, nurse)
                DB->>DB: FOR UPDATE, проверить срок, статус, получателя и историю
                alt Уже подтверждено или другое правило нарушено
                    DB-->>Worker: Отказ процедуры
                    Worker->>DB: ROLLBACK к SAVEPOINT
                else Эскалация разрешена
                    DB->>DB: ESCALATED, получатель и время
                    DB->>DB: Триггер добавляет ESCALATED в журнал (каждую эскалацию)
                    DB-->>Worker: Успех
                end
            end
        end
        Worker->>DB: COMMIT
    end
    Post->>API: GET /api/alerts, опрос раз в секунду
    API->>DB: Получить оповещения палаты и текущих или прошлых назначений на сигнал
    API-->>Post: Карточка с отметкой эскалации
```

**Что проверяем:** LOW не эскалируется. Процедура повторяет проверку под
блокировкой. При наличии кандидатов после `Available` возможен вызов `Busy`,
в том числе старшей медсестры. Одного сотрудника не зовут дважды на один
сигнал. Ранее вызванные могут подтвердить открытое оповещение на смене.
После исчерпания кандидатов сигнал остаётся у последнего получателя, если он
был назначен. Вызов `OffShift` остаётся планом T-52/T-57. См. решения 12–13.

## 7. Отчёт старшей медсестры (UC-8)

Реализовано: `ReportPage.tsx`, `routers/reports.py`, `vw_AlertResponse`,
`AlertEvent`, роль `medbase_head_nurse`. FR-28 — FR-31.

```mermaid
sequenceDiagram
    autonumber
    actor Head as Старшая медсестра
    participant UI as ReportPage
    participant API as FastAPI reports
    participant DB as PostgreSQL
    Head->>UI: Выбирает период отчёта
    UI->>API: GET /api/reports/alerts?hours=N
    alt Нет сессии или роль не HeadNurse
        API-->>UI: 401 или 403
    else Разрешённая роль
        API->>DB: BEGIN, SET LOCAL ROLE medbase_head_nurse
        DB->>DB: Проверить GRANT на vw_AlertResponse
        API->>DB: Сводка, приоритеты, медсёстры, последние 500 записей
        DB-->>API: Реакция = подтверждение минус создание
        API->>DB: COMMIT
        API-->>UI: Отчёт без идентификаторов и имён пациентов
        Head->>UI: Открывает историю оповещения
        UI->>API: GET /api/reports/alerts/alert_id/events
        API->>DB: medbase_head_nurse читает AlertEvent
        DB-->>API: Создание, назначение, все эскалации, подтверждение
        API-->>UI: Хронология событий
    end
```

**Что проверяем:** отчёт только читает данные. Обычная медсестра не может
прочитать отчёт или журнал ни через API, ни непосредственно под своей ролью
PostgreSQL через роль чтения полного журнала. Её роль читает только ограниченный
набор полей `AlertEvent` для отображения прошлых эскалаций. Сводка считает весь
период, история ограничена 500 записями.

## 8. Назначение медсестры на палату (T-51/T-54)

```mermaid
sequenceDiagram
    autonumber
    actor Head as Старшая медсестра
    participant UI as Назначения
    participant API as FastAPI
    participant DB as PostgreSQL
    Head->>UI: Выбирает новую основную медсестру
    UI->>API: PUT /api/assignments/{ward_id}/primary
    alt Сессия или роль не подходят
        API-->>UI: 401 или 403
    else HeadNurse
        API->>DB: SET LOCAL ROLE medbase_head_nurse
        API->>DB: sp_AssignWardNurse с ID автора из сессии
        DB->>DB: Блокировка строки палаты и проверка назначения
        alt Правило нарушено
            DB-->>API: Транзакция откатывается
            API-->>UI: 409
        else Замена разрешена
            DB->>DB: Сменить основную и добавить NurseAssignmentLog
            API->>DB: COMMIT
            API-->>UI: Обновлённое назначение
        end
    end
```

Процедуры удаления и добавления дополнительных медсестёр сохраняют основную.
После коммита новый сигнал учитывает назначения, у существующего сигнала
сохраняется первоначальный получатель. Автоподбор при `OffShift` пишет журнал.

## 9. Коридорное табло без входа (T-55)

```mermaid
sequenceDiagram
    autonumber
    participant Screen as Экран коридора
    participant Proxy as nginx 8081
    participant API as FastAPI board
    participant DB as PostgreSQL
    Screen->>Proxy: Открыть выделенную страницу табло
    loop Интервал из refresh_seconds
        Screen->>Proxy: GET /api/board/summary
        Proxy->>API: Передать адрес экрана и заголовок токена при наличии
        alt Сеть или токен допущены
            API->>DB: SET LOCAL ROLE medbase_board
            API->>DB: Читать vw_WardCapacity и vw_CorridorAlerts
            DB-->>API: Занятость, приоритет, ожидание и статус
            API-->>Screen: Только сводка, Cache-Control no-store
        else Экран не допущен
            API-->>Screen: 403
        end
    end
```

Адрес из `X-Real-IP` учитывается только от настроенного доверенного прокси.
При отсутствии ответа больше пяти секунд экран отмечает потерю связи. Метка
`outside_call` относится к эскалации за пределы назначений палаты.

## 10. Сканирование, вход и перевыпуск бейджа (T-53/T-56)

```mermaid
sequenceDiagram
    autonumber
    actor Staff as Сотрудник
    actor Head as Старшая медсестра
    participant UI as Интерфейс персонала
    participant API as FastAPI
    participant DB as PostgreSQL
    UI->>API: GET /api/auth/options
    API-->>UI: Режим входа
    Staff->>UI: Сканирует Code 128 камерой или клавиатурным сканером
    alt Штатный режим
        Staff->>UI: Вводит PIN
        UI->>API: POST /api/auth/login с бейджем и PIN
        API->>DB: fn_LoginStaff проверяет блокировку и PIN
    else Включён локальный демо-режим
        UI->>API: POST /api/auth/login с бейджем
        API->>DB: fn_LoginStaffByBadge проверяет блокировку и номер
    end
    API-->>UI: Итог входа
    Head->>UI: Выбирает перевыпуск
    UI->>API: POST /api/badges/{person_id}/reissue
    API->>DB: HeadNurse, fn_ReissueBadge и ID автора из сессии
    DB->>DB: Записать RetiredBadge и изменить номер
    API-->>UI: Новый номер после фиксации транзакции
```

Камере нужен безопасный контекст браузера. При новом входе старый номер
отклоняется. Ранее выданная сессия проверяется отдельно и сохраняет свой срок.

## 11. Связь диаграмм с проверками и направлением разработки

| Сценарий | Существующие проверки | Новый вклад Architecture & Security |
|---|---|---|
| Вход и права | `tests/test_auth.py`, `tests/test_login_lockout.py` | Матрица T-34 охватывает четыре исходные роли. Тесты заявки и бейджей дополняют покрытие |
| UC-1 — UC-3 | `tests/test_admissions.py`, SQL-тесты процедур | Запрет чтения, госпитализации, перевода и выписки чужим ролям; отсутствие изменений при отказе |
| UC-4 | `tests/test_admissions.py` | Точный список полей табло без персональных данных |
| UC-5, UC-6 | `tests/test_alerts.py` | Доступ к симулятору и посту; чужая палата; выключенный симулятор |
| UC-7 | `tests/test_alerts.py`, `tests/test_escalation.py`, SQL-тесты | Схема worker, защита транзакции, доставка предыдущим получателям. Замеры T-29 относятся к версии до PR #25/#27 |
| UC-8 | `tests/test_reports.py`, SQL-тесты прав | Endpoints отчёта и журнала в матрице: только HeadNurse; отчёт и журнал закрыты в PostgreSQL для остальных ролей |
| Назначения | `tests/test_assignments_api.py`, `tests/test_assignment_alerts.py`, SQL | Роль HeadNurse, журнал, смена основной и разделение существующих и новых сигналов |
| Табло | `tests/test_board.py`, `frontend/e2e/corridor-board.spec.ts` | Граница сети, выделенный порт и минимальная сводка |
| Бейджи | `tests/test_badges.py` | Права печати и перевыпуска, обязательность PIN по умолчанию и отклонение старого номера |

Реализация движется к согласованным двум процессам: UC-1 — UC-8 связаны
API и UI. Диаграммы помогают проверить,
что новый код сохраняет транзакции, историю и оба слоя контроля доступа.
Зелёные тесты прав подтверждают этот аспект, но не заменяют приёмку всех
сценариев, измерение задержек, тест звука и полную проверку безопасности.

Отчёты: [права API](testing/api-permissions-report.md), [замеры T-29](testing/alert-timing-report.md),
[ревью T-50/T-59](reviews/t50-t59-security-review.md).
