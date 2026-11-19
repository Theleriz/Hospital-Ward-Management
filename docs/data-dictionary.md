# Data Dictionary — Hospital Ward Management System (Team MedBase)

Полное описание структуры базы данных PostgreSQL 17 (схема v2).

---

## 1. Таблица `Patient` (Пациенты)

Хранит персональные и демографические данные пациентов отделения.

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `PatientID` | `SERIAL` | `PRIMARY KEY` | Уникальный идентификатор пациента (автоинкремент) |
| `FullName` | `VARCHAR(100)` | `NOT NULL` | Полное имя пациента |
| `DOB` | `DATE` | `NOT NULL` | Дата рождения пациента |
| `Phone` | `VARCHAR(20)` | `UNIQUE` | Контактный номер телефона (уникальный) |
| `Gender` | `VARCHAR(10)` | — | Пол пациента |

---

## 2. Таблица `Ward` (Палаты)

Хранит информацию о палатах отделения и их коечном фонде.

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `WardID` | `INT` | `PRIMARY KEY` | Уникальный номер палаты |
| `WardName` | `VARCHAR(50)` | `NOT NULL` | Название или номер палаты |
| `FloorNum` | `INT` | `NOT NULL` | Номер этажа |
| `Capacity` | `INT` | `NOT NULL`, `CHECK ("Capacity" > 0)` | Вместимость палаты (количество коек, строго больше 0) |
| `WardType` | `VARCHAR(50)` | `NOT NULL`, `CK_Ward_ValidType` | Профиль палаты: `'Intensive Care'`, `'General Medicine'`, `'Surgery'`, `'Emergency'` |

---

## 3. Таблица `Admission` (Госпитализация)

Таблица-мост между пациентами и палатами. Фиксирует текущее размещение и историю госпитализаций.

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `AdmissionID` | `SERIAL` | `PRIMARY KEY` | Уникальный идентификатор записи о госпитализации |
| `PatientID` | `INT` | `NOT NULL`, `FK -> Patient(PatientID) ON DELETE RESTRICT` | Ссылка на пациента |
| `WardID` | `INT` | `NOT NULL`, `FK -> Ward(WardID) ON DELETE RESTRICT` | Ссылка на палату |
| `AdmitDate` | `DATE` | `NOT NULL`, `DEFAULT CURRENT_DATE` | Дата поступления в палату |
| `DischargeDate` | `DATE` | `CK_Admission_DischargeDate` | Дата выписки или перевода из палаты (`NULL` для активной госпитализации) |
| `Status` | `VARCHAR(20)` | `NOT NULL`, `DEFAULT 'Active'`, `CHECK ("Status" IN ('Active', 'Discharged'))` | Статус госпитализации: `'Active'` (в палате) или `'Discharged'` (выписан/переведён) |

**Правила и индексы таблицы `Admission`:**
* **`CK_Admission_DischargeDate`:** требует, чтобы `DischargeDate` был заполнен ровно тогда, когда `Status = 'Discharged'` (`("Status" = 'Discharged') = ("DischargeDate" IS NOT NULL)`), и при наличии даты выполнялось условие `DischargeDate >= AdmitDate`.
* **`UX_Admission_OneActivePerPatient`:** частичный уникальный индекс по `PatientID` (`WHERE "Status" = 'Active'`), запрещающий одновременно держать одного пациента в двух палатах.
* **`IX_Admission_Ward_Status`:** составной индекс по `(WardID, Status)` для быстрого подсчёта занятости палат.
* **`ON DELETE RESTRICT`:** запрещает удаление пациента или палаты, если по ним есть записи о госпитализации.

---

## 4. Таблица `Nurse` (Медсёстры)

Хранит учётные записи палатных и старших медсестёр, данные для входа по бейджу/PIN и текущий статус смены.

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `NurseID` | `VARCHAR(20)` | `PRIMARY KEY` | Уникальный табельный идентификатор медсестры |
| `FullName` | `VARCHAR(100)` | `NOT NULL` | Полное имя медсестры |
| `BadgeID` | `VARCHAR(32)` | `NOT NULL`, `UNIQUE` | Уникальный идентификатор RFID-бейджа |
| `PinHash` | `TEXT` | `NOT NULL`, `CK_Nurse_PinIsBcrypt` | `bcrypt`-хэш PIN-кода (формат `^\$2[aby]\$\d{2}\$.{53}$`, хранение открытого PIN запрещено) |
| `Role` | `VARCHAR(20)` | `NOT NULL`, `DEFAULT 'Nurse'`, `CHECK ("Role" IN ('Nurse', 'HeadNurse'))` | Роль в отделении: `'Nurse'` (палатная медсестра) или `'HeadNurse'` (старшая медсестра) |
| `Status` | `VARCHAR(20)` | `NOT NULL`, `DEFAULT 'OffShift'`, `CHECK ("Status" IN ('Available', 'Busy', 'OffShift'))` | Текущий статус смены: `'Available'`, `'Busy'` или `'OffShift'` |

**Правила таблицы `Nurse`:**
* **`TR_Nurse_BadgeIsUnique`:** триггер гарантирует уникальность `BadgeID` одновременно по двум таблицам (`Nurse` и `StaffAccount`).

---

## 5. Таблица `NurseAssignment` (Закрепление медсестёр за палатами)

Связывает медсестёр с обслуживаемыми палатами и определяет основную ответственную медсестру.

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `NurseID` | `VARCHAR(20)` | `PRIMARY KEY`, `NOT NULL`, `FK -> Nurse(NurseID) ON DELETE RESTRICT` | Ссылка на медсестру |
| `WardID` | `INT` | `PRIMARY KEY`, `NOT NULL`, `FK -> Ward(WardID) ON DELETE RESTRICT` | Ссылка на палату |
| `IsPrimary` | `BOOLEAN` | `NOT NULL`, `DEFAULT FALSE` | Признак основной медсестры палаты (получает оповещения первой) |

**Правила и индексы таблицы `NurseAssignment`:**
* **`UX_NurseAssignment_OnePrimaryPerWard`:** частичный уникальный индекс по `WardID` (`WHERE "IsPrimary"`), гарантирующий не более одной основной медсестры на палату.

---

## 6. Таблица `StaffAccount` (Учётные записи прочего персонала)

Хранит учётные записи сотрудников отделения, не являющихся медсёстрами (сотрудники приёмного отделения и прочий персонал).

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `AccountID` | `VARCHAR(20)` | `PRIMARY KEY` | Уникальный идентификатор учётной записи сотрудника |
| `FullName` | `VARCHAR(100)` | `NOT NULL` | Полное имя сотрудника |
| `BadgeID` | `VARCHAR(32)` | `NOT NULL`, `UNIQUE` | Уникальный идентификатор RFID-бейджа |
| `PinHash` | `TEXT` | `NOT NULL`, `CK_StaffAccount_PinIsBcrypt` | `bcrypt`-хэш PIN-кода (формат `^\$2[aby]\$\d{2}\$.{53}$`) |
| `Role` | `VARCHAR(20)` | `NOT NULL`, `CHECK ("Role" IN ('Admissions', 'PublicStaff'))` | Роль доступа: `'Admissions'` (приёмное отделение) или `'PublicStaff'` (прочий персонал) |
| `IsActive` | `BOOLEAN` | `NOT NULL`, `DEFAULT TRUE` | Признак активности учётной записи |

**Правила таблицы `StaffAccount`:**
* **`TR_StaffAccount_BadgeIsUnique`:** триггер проверяет, что `BadgeID` не занят в таблице `Nurse`.

---

## 7. Таблица `WardAlert` (Оповещения по палатам)

Хранит медицинские оповещения от мониторов и кнопок вызова, их приоритет, маршрутизацию, факт эскалации и подтверждения.

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `AlertID` | `VARCHAR(20)` | `PRIMARY KEY`, `DEFAULT 'ALT-' \|\| nextval('"WardAlert_AlertNo_seq"')` | Уникальный код оповещения формата `ALT-1001`, `ALT-1002` и далее |
| `WardID` | `INT` | `NOT NULL`, `FK -> Ward(WardID) ON DELETE RESTRICT` | Палата, из которой поступило оповещение |
| `PatientID` | `INT` | `FK -> Patient(PatientID) ON DELETE RESTRICT` | Пациент, к которому относится оповещение (допускает `NULL`, например, при нажатии кнопки вызова в коридоре без привязки к пациенту) |
| `Source` | `VARCHAR(20)` | `NOT NULL`, `CHECK ("Source" IN ('MONITOR', 'CALL_BUTTON'))` | Источник оповещения: прикроватный монитор (`'MONITOR'`) или кнопка вызова (`'CALL_BUTTON'`) |
| `Priority` | `VARCHAR(10)` | `NOT NULL`, `CHECK ("Priority" IN ('LOW', 'HIGH', 'CRITICAL'))` | Уровень приоритета оповещения: `'LOW'`, `'HIGH'` или `'CRITICAL'` |
| `Description` | `TEXT` | — | Текстовое описание события или причины вызова |
| `Status` | `VARCHAR(20)` | `NOT NULL`, `DEFAULT 'PENDING'`, `CHECK ("Status" IN ('PENDING', 'ACKNOWLEDGED', 'ESCALATED'))` | Статус обработки: `'PENDING'` (ожидает), `'ESCALATED'` (эскалировано), `'ACKNOWLEDGED'` (подтверждено) |
| `AssignedNurseID` | `VARCHAR(20)` | `FK -> Nurse(NurseID) ON DELETE RESTRICT` | Медсестра, которой оповещение было назначено изначально |
| `EscalatedToNurseID` | `VARCHAR(20)` | `FK -> Nurse(NurseID) ON DELETE RESTRICT` | Медсестра, которой оповещение передано при эскалации (`NULL`, если эскалации не было) |
| `AcknowledgedByNurseID` | `VARCHAR(20)` | `FK -> Nurse(NurseID) ON DELETE RESTRICT` | Медсестра, фактически подтвердившая оповещение (`NULL`, пока не подтверждено) |
| `CreatedAt` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT CURRENT_TIMESTAMP` | Дата и время создания оповещения |
| `EscalatedAt` | `TIMESTAMPTZ` | — | Дата и время эскалации оповещения |
| `AcknowledgedAt` | `TIMESTAMPTZ` | — | Дата и время подтверждения оповещения |
| `UpdatedAt` | `TIMESTAMPTZ` | `NOT NULL`, `DEFAULT CURRENT_TIMESTAMP` | Дата и время последнего обновления записи |

**Правила и ограничения таблицы `WardAlert`:**
* **`CK_WardAlert_Acknowledged`:** статус `'ACKNOWLEDGED'` устанавливается тогда и только тогда, когда заполнены оба поля `AcknowledgedByNurseID` и `AcknowledgedAt`.
* **`CK_WardAlert_Escalated`:** поля `EscalatedToNurseID` и `EscalatedAt` заполняются только совместно; при статусе `'ESCALATED'` наличие медсестры эскалации обязательно.
* **`CK_WardAlert_NoLowEscalation`:** оповещения с приоритетом `'LOW'` не подлежат эскалации (`EscalatedToNurseID` должно оставаться `NULL`).
* **`CK_WardAlert_Timeline`:** временные метки эскалации (`EscalatedAt`) и подтверждения (`AcknowledgedAt`) не могут быть раньше времени создания оповещения (`CreatedAt`).
* **Генерация ID и целостность связей:** значение `AlertID` по умолчанию формируется как `'ALT-'` + следующий номер из последовательности `WardAlert_AlertNo_seq` (начиная с `1001`); все внешние ключи таблицы используют `ON DELETE RESTRICT`.
* **`IX_WardAlert_Status_Created`:** составной индекс по `(Status, CreatedAt)` для быстрого поиска просроченных неподтверждённых оповещений.

---

## 8. Таблица `AlertEvent` (Журнал событий оповещений)

Неизменяемый (*append-only*) аудит-журнал всех этапов жизненного цикла каждого оповещения.

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `EventID` | `BIGSERIAL` | `PRIMARY KEY` | Уникальный порядковый номер записи в журнале |
| `AlertID` | `VARCHAR(20)` | `NOT NULL`, `FK -> WardAlert(AlertID) ON DELETE RESTRICT` | Оповещение, к которому относится событие |
| `EventType` | `VARCHAR(20)` | `NOT NULL`, `CHECK ("EventType" IN ('CREATED', 'ASSIGNED', 'ESCALATED', 'ACKNOWLEDGED'))` | Тип зафиксированного события: создание, назначение, эскалация или подтверждение |
| `NurseID` | `VARCHAR(20)` | `FK -> Nurse(NurseID) ON DELETE RESTRICT` | Медсестра, связанная с событием (`NULL` для события `'CREATED'`) |
| `OccurredAt` | `TIMESTAMPTZ` | `NOT NULL` | Точное время наступления события |

**Правила и триггеры таблицы `AlertEvent`:**
* **`TR_WardAlert_LogEvents`:** автоматически записывает в журнал создание оповещения, первичное/повторное назначение, каждую эскалацию (включая повторную эскалацию на следующую медсестру) и подтверждение.
* **`TR_AlertEvent_AppendOnly`:** блокирует любые операции `UPDATE` и `DELETE` на уровне СУБД (даже для владельца таблицы), обеспечивая неизменяемость журнала аудита.
* **`IX_AlertEvent_Alert`:** составной индекс по `(AlertID, OccurredAt)` для быстрого построения хронологии по оповещению.

---

## 9. Представления (Views)

### `vw_WardCapacity` (Занятость палат)

Представление для табло занятости и прочего персонала (`medbase_public_staff`). Возвращает агрегированную статистику без раскрытия персональных данных пациентов.

| Столбец | Тип данных | Описание |
| :--- | :--- | :--- |
| `WardID` | `INT` | Уникальный номер палаты |
| `WardName` | `VARCHAR(50)` | Название палаты |
| `FloorNum` | `INT` | Номер этажа |
| `WardType` | `VARCHAR(50)` | Профиль палаты |
| `Capacity` | `INT` | Общая вместимость палаты (количество коек) |
| `CurrentOccupancy` | `BIGINT` | Текущее количество занятых коек (по записям `Admission` со статусом `'Active'`) |
| `AvailableBeds` | `BIGINT` | Количество свободных коек (`Capacity - CurrentOccupancy`) |

### `vw_AlertResponse` (Отчёт старшей медсестры по времени реакции)

Представление для роли старшей медсестры (`medbase_head_nurse`, сценарий UC-8). Возвращает аналитику по каждому оповещению с расчётом времени реакции и признаком эскалации без раскрытия персональных данных пациентов.

| Столбец | Тип данных | Описание |
| :--- | :--- | :--- |
| `AlertID` | `VARCHAR(20)` | Уникальный код оповещения |
| `WardID` | `INT` | Номер палаты |
| `WardName` | `VARCHAR(50)` | Название палаты |
| `Source` | `VARCHAR(20)` | Источник оповещения (`'MONITOR'` или `'CALL_BUTTON'`) |
| `Priority` | `VARCHAR(10)` | Приоритет оповещения (`'LOW'`, `'HIGH'`, `'CRITICAL'`) |
| `Description` | `TEXT` | Описание оповещения |
| `Status` | `VARCHAR(20)` | Текущий статус оповещения (`'PENDING'`, `'ESCALATED'`, `'ACKNOWLEDGED'`) |
| `AssignedNurseID` | `VARCHAR(20)` | ID первоначально назначенной медсестры |
| `AssignedNurseName` | `VARCHAR(100)` | Полное имя первоначально назначенной медсестры |
| `EscalatedToNurseID` | `VARCHAR(20)` | ID медсестры, которой передано оповещение при эскалации (`NULL`, если эскалации не было) |
| `EscalatedToNurseName` | `VARCHAR(100)` | Полное имя медсестры эскалации (`NULL`, если эскалации не было) |
| `AcknowledgedByNurseID` | `VARCHAR(20)` | ID медсестры, подтвердившей оповещение (`NULL`, если ещё не подтверждено) |
| `AcknowledgedByNurseName` | `VARCHAR(100)` | Полное имя медсестры, подтвердившей оповещение (`NULL`, если ещё не подтверждено) |
| `CreatedAt` | `TIMESTAMPTZ` | Дата и время создания оповещения |
| `EscalatedAt` | `TIMESTAMPTZ` | Дата и время эскалации (`NULL`, если эскалации не было) |
| `AcknowledgedAt` | `TIMESTAMPTZ` | Дата и время подтверждения (`NULL`, если ещё не подтверждено) |
| `ResponseTime` | `INTERVAL` | Время реакции от создания до подтверждения (`AcknowledgedAt - CreatedAt`, согласно FR-29) |
| `ResponseSeconds` | `NUMERIC(10, 1)` | Время реакции в секундах с точностью до десятых (`NULL`, если ещё не подтверждено) |
| `WasEscalated` | `BOOLEAN` | Признак того, была ли выполнена эскалация (`EscalatedToNurseID IS NOT NULL`, согласно FR-30) |