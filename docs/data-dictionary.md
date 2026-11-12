# Data Dictionary — Hospital Ward Management System (Team MedBase)

Полное описание структуры базы данных PostgreSQL (версия v2).

---

## 1. Таблица `Patient` (Пациенты)
Хранит персональные и демографические данные пациентов.

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `PatientID` | `SERIAL` | `PRIMARY KEY` | Уникальный идентификатор пациента (автоинкремент) |
| `FullName` | `VARCHAR(100)` | `NOT NULL` | Полное имя пациента |
| `DOB` | `DATE` | `NOT NULL` | Дата рождения |
| `Phone` | `VARCHAR(20)` | `UNIQUE` | Номер телефона (уникальный) |
| `Gender` | `VARCHAR(10)` | — | Пол пациента |

---

## 2. Таблица `Ward` (Палаты)
Хранит информацию о физических палатах больницы.

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `WardID` | `INT` | `PRIMARY KEY` | Уникальный номер палаты |
| `WardName` | `VARCHAR(50)` | `NOT NULL` | Название палаты |
| `FloorNum` | `INT` | `NOT NULL` | Номер этажа |
| `Capacity` | `INT` | `NOT NULL`, `CHECK (> 0)` | Вместимость палаты (количество коек) |
| `WardType` | `VARCHAR(50)` | `NOT NULL`, `CHECK (IN ...)` | Тип палаты: Intensive Care, General Medicine, Surgery, Emergency |

---

## 3. Таблица `Admission` (Госпитализация)
Таблица-мост между пациентами и палатами. Отслеживает историю и текущее состояние пребывания пациента.

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `AdmissionID` | `SERIAL` | `PRIMARY KEY` | Уникальный ID записи госпитализации |
| `PatientID` | `INT` | `FOREIGN KEY (Patient)`, `ON DELETE RESTRICT` | Ссылка на пациента |
| `WardID` | `INT` | `FOREIGN KEY (Ward)`, `ON DELETE RESTRICT` | Ссылка на палату |
| `AdmitDate` | `DATE` | `NOT NULL`, `DEFAULT CURRENT_DATE` | Дата поступления |
| `DischargeDate`| `DATE` | `CHECK` (`CK_Admission_DischargeDate`) | Дата выписки или перевода; заполнена ровно тогда, когда `Status = 'Discharged'`, и не раньше `AdmitDate` |
| `Status` | `VARCHAR(20)` | `NOT NULL`, `CHECK ('Active', 'Discharged')` | Статус пребывания |

*Примечание:* Уникальный индекс `UX_Admission_OneActivePerPatient` гарантирует, что у пациента может быть только одна запись со статусом `Active`. `Status` по умолчанию `'Active'`. Индекс `IX_Admission_Ward_Status` ускоряет подсчёт занятости палат.

---

## 4. Таблица `Nurse` (Медсёстры)
Учётные записи и статусы палатных и старших медсестёр.

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `NurseID` | `VARCHAR(20)` | `PRIMARY KEY` | Табельный номер медсестры (напр. NURSE-01) |
| `FullName` | `VARCHAR(100)` | `NOT NULL` | ФИО медсестры |
| `BadgeID` | `VARCHAR(32)` | `NOT NULL`, `UNIQUE` | Уникальный номер физического бейджа |
| `PinHash` | `TEXT` | `NOT NULL`, `CHECK (bcrypt)` (`CK_Nurse_PinIsBcrypt`) | Хэш PIN-кода (bcrypt); открытый PIN сохранить нельзя |
| `Role` | `VARCHAR(20)` | `NOT NULL`, `DEFAULT 'Nurse'`, `CHECK ('Nurse', 'HeadNurse')` | Роль: палатная или старшая медсестра |
| `Status` | `VARCHAR(20)` | `NOT NULL`, `DEFAULT 'OffShift'`, `CHECK ('Available', 'Busy', 'OffShift')` | Рабочий статус: `Available` — на смене и свободна (может получить эскалацию), `Busy` — на смене и занята, `OffShift` — не на смене |

---

## 5. Таблица `NurseAssignment` (Назначения на палаты)
Связывает медсестёр с палатами на смене.

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `NurseID` | `VARCHAR(20)` | `FOREIGN KEY (Nurse)`, `ON DELETE RESTRICT` | Ссылка на медсестру |
| `WardID` | `INT` | `FOREIGN KEY (Ward)`, `ON DELETE RESTRICT` | Ссылка на палату |
| `IsPrimary` | `BOOLEAN` | `NOT NULL`, `DEFAULT FALSE` | Флаг основной медсестры палаты |

*Составной первичный ключ:* (`NurseID`, `WardID`). Индекс `UX_NurseAssignment_OnePrimaryPerWard` обеспечивает максимум 1 основную медсестру на палату.

---

## 6. Таблица `StaffAccount` (Прочий персонал)
Учётные записи сотрудников, которые не являются медсёстрами: приёмное отделение (`Admissions`) и прочий персонал (`PublicStaff`). Медсёстры входят по бейджу из таблицы `Nurse`; один бейдж принадлежит ровно одному человеку в обеих таблицах (триггеры `TR_Nurse_BadgeIsUnique`, `TR_StaffAccount_BadgeIsUnique`).

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `AccountID` | `VARCHAR(20)` | `PRIMARY KEY` | Идентификатор аккаунта |
| `FullName` | `VARCHAR(100)` | `NOT NULL` | ФИО сотрудника |
| `BadgeID` | `VARCHAR(32)` | `NOT NULL`, `UNIQUE` | Уникальный бейдж |
| `PinHash` | `TEXT` | `NOT NULL`, `CHECK (bcrypt)` (`CK_StaffAccount_PinIsBcrypt`) | Хэш PIN-кода (bcrypt) |
| `Role` | `VARCHAR(20)` | `NOT NULL`, `CHECK ('Admissions', 'PublicStaff')` | Роль: приёмное отделение или прочий персонал |
| `IsActive` | `BOOLEAN` | `NOT NULL`, `DEFAULT TRUE` | Активен ли аккаунт; с неактивным войти нельзя |

---

## 7. Таблица `WardAlert` (Оповещения)
Оповещения медсёстрам от мониторов пациентов и кнопок вызова (UC-5 — UC-7).

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `AlertID` | `VARCHAR(20)` | `PRIMARY KEY`, по умолчанию `'ALT-'` + номер из `WardAlert_AlertNo_seq` | Номер оповещения (ALT-1001, ALT-1002, …) |
| `WardID` | `INT` | `NOT NULL`, `FOREIGN KEY (Ward)`, `ON DELETE RESTRICT` | Палата, где возникло оповещение |
| `PatientID` | `INT` | `FOREIGN KEY (Patient)`, `ON DELETE RESTRICT` | Пациент; `NULL`, если кнопку вызова нажали не у койки (например, в коридоре) |
| `Source` | `VARCHAR(20)` | `NOT NULL`, `CHECK ('MONITOR', 'CALL_BUTTON')` | Источник: монитор пациента или кнопка вызова |
| `Priority` | `VARCHAR(10)` | `NOT NULL`, `CHECK ('LOW', 'HIGH', 'CRITICAL')` | Приоритет |
| `Description` | `TEXT` | — | Описание (например, «SpO2 84%») |
| `Status` | `VARCHAR(20)` | `NOT NULL`, `DEFAULT 'PENDING'`, `CHECK ('PENDING', 'ACKNOWLEDGED', 'ESCALATED')` | Состояние оповещения |
| `AssignedNurseID` | `VARCHAR(20)`| `FOREIGN KEY (Nurse)`, `ON DELETE RESTRICT` | Медсестра, которой оповещение назначено первой; после эскалации не меняется |
| `EscalatedToNurseID` | `VARCHAR(20)`| `FOREIGN KEY (Nurse)`, `ON DELETE RESTRICT` | Медсестра, которой оповещение эскалировано |
| `AcknowledgedByNurseID`| `VARCHAR(20)`| `FOREIGN KEY (Nurse)`, `ON DELETE RESTRICT` | Медсестра, подтвердившая оповещение |
| `CreatedAt` | `TIMESTAMPTZ`| `NOT NULL`, `DEFAULT CURRENT_TIMESTAMP` | Время создания оповещения |
| `EscalatedAt` | `TIMESTAMPTZ`| — | Время эскалации |
| `AcknowledgedAt` | `TIMESTAMPTZ`| — | Время подтверждения; время реакции = `AcknowledgedAt − CreatedAt` |
| `UpdatedAt` | `TIMESTAMPTZ`| `NOT NULL`, `DEFAULT CURRENT_TIMESTAMP` | Время последнего изменения |

*Правила согласованности (CHECK):*
- `CK_WardAlert_Acknowledged`: статус `ACKNOWLEDGED` тогда и только тогда, когда заполнены `AcknowledgedByNurseID` и `AcknowledgedAt`;
- `CK_WardAlert_Escalated`: `EscalatedToNurseID` и `EscalatedAt` заполняются вместе, статус `ESCALATED` требует медсестру эскалации;
- `CK_WardAlert_NoLowEscalation`: оповещение `LOW` не эскалируется;
- `CK_WardAlert_Timeline`: эскалация и подтверждение не раньше создания.

Индекс `IX_WardAlert_Status_Created` ускоряет поиск открытых и просроченных оповещений. Изменять оповещения можно только
через процедуры `sp_RaiseAlert`, `sp_EscalateAlert` и `sp_AcknowledgeAlert`: напрямую писать в таблицу не может ни одна
роль приложения.

---

## 8. Таблица `AlertEvent` (Журнал оповещений)
Неизменяемый (append-only) журнал всех событий оповещений. Заполняется триггером `TR_WardAlert_LogEvents` (функция `fn_LogAlertEvents`) при каждом изменении `WardAlert`. Триггер `TR_AlertEvent_AppendOnly` запрещает `UPDATE` и `DELETE` даже владельцу базы (NFR-04). Читает журнал только старшая медсестра.

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `EventID` | `BIGSERIAL` | `PRIMARY KEY` | Порядковый номер события |
| `AlertID` | `VARCHAR(20)` | `NOT NULL`, `FOREIGN KEY (WardAlert)`, `ON DELETE RESTRICT` | Ссылка на оповещение |
| `EventType` | `VARCHAR(20)` | `NOT NULL`, `CHECK ('CREATED', 'ASSIGNED', 'ESCALATED', 'ACKNOWLEDGED')` | Тип события |
| `NurseID` | `VARCHAR(20)` | `FOREIGN KEY (Nurse)`, `ON DELETE RESTRICT` | Медсестра события (`NULL` для `CREATED`) |
| `OccurredAt` | `TIMESTAMPTZ`| `NOT NULL` | Время совершения события |

---

## 9. Представление `vw_WardCapacity`
Представление для расчета свободных мест в палатах в реальном времени.

| Столбец | Тип данных | Описание |
| :--- | :--- | :--- |
| `WardID` | `INT` | ID палаты |
| `WardName` | `VARCHAR(50)` | Название палаты |
| `FloorNum` | `INT` | Этаж |
| `WardType` | `VARCHAR(50)` | Тип палаты |
| `Capacity` | `INT` | Максимальная вместимость |
| `CurrentOccupancy` | `BIGINT` | Количество активных пациентов в данный момент |
| `AvailableBeds` | `BIGINT` | Количество свободных коек (`Capacity - CurrentOccupancy`) |

Доступно всем ролям, включая прочий персонал: данных пациентов в представлении нет (UC-4, NFR-03).

---

## 10. Представление `vw_AlertResponse`
Отчёт старшей медсестры (UC-8): одна строка на оповещение, без данных пациентов. Читает только роль `medbase_head_nurse`.

| Столбец | Тип данных | Описание |
| :--- | :--- | :--- |
| `AlertID` | `VARCHAR(20)` | Номер оповещения |
| `WardID` | `INT` | ID палаты |
| `WardName` | `VARCHAR(50)` | Название палаты |
| `Source` | `VARCHAR(20)` | Источник оповещения |
| `Priority` | `VARCHAR(10)` | Приоритет |
| `Description` | `TEXT` | Описание |
| `Status` | `VARCHAR(20)` | Состояние оповещения |
| `AssignedNurseID`, `AssignedNurseName` | `VARCHAR(20)`, `VARCHAR(100)` | Медсестра, которой оповещение назначено первой |
| `EscalatedToNurseID`, `EscalatedToNurseName` | `VARCHAR(20)`, `VARCHAR(100)` | Медсестра эскалации |
| `AcknowledgedByNurseID`, `AcknowledgedByNurseName` | `VARCHAR(20)`, `VARCHAR(100)` | Подтвердившая медсестра |
| `CreatedAt`, `EscalatedAt`, `AcknowledgedAt` | `TIMESTAMPTZ` | Время создания, эскалации и подтверждения |
| `ResponseTime` | `INTERVAL` | Время реакции: `AcknowledgedAt − CreatedAt` (FR-29); `NULL`, пока не подтверждено |
| `ResponseSeconds` | `NUMERIC(10,1)` | То же в секундах |
| `WasEscalated` | `BOOLEAN` | Было ли оповещение эскалировано (FR-30) |
