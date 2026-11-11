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
| `DischargeDate`| `DATE` | `CHECK (DischargeDate >= AdmitDate)` | Дата выписки или перевода |
| `Status` | `VARCHAR(20)` | `NOT NULL`, `CHECK ('Active', 'Discharged')` | Статус пребывания |

*Примечание:* Уникальный индекс `UX_Admission_OneActivePerPatient` гарантирует, что у пациента может быть только одна запись со статусом `Active`.

---

## 4. Таблица `Nurse` (Медсёстры)
Учётные записи и статусы палатных и старших медсестёр.

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `NurseID` | `VARCHAR(20)` | `PRIMARY KEY` | Табельный номер медсестры (напр. NURSE-01) |
| `FullName` | `VARCHAR(100)` | `NOT NULL` | ФИО медсестры |
| `BadgeID` | `VARCHAR(32)` | `NOT NULL`, `UNIQUE` | Уникальный номер физического бейджа |
| `PinHash` | `TEXT` | `NOT NULL`, `CHECK (bcrypt)` | Хэш PIN-кода (bcrypt) |
| `Role` | `VARCHAR(20)` | `CHECK ('Nurse', 'HeadNurse')` | Роль медсестры |
| `Status` | `VARCHAR(20)` | `CHECK ('Available', 'Busy', 'OffShift')` | Текущий рабочий статус |

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
Учётные записи сотрудников приёмного отделения и администраторов.

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `AccountID` | `VARCHAR(20)` | `PRIMARY KEY` | Идентификатор аккаунта |
| `FullName` | `VARCHAR(100)` | `NOT NULL` | ФИО сотрудника |
| `BadgeID` | `VARCHAR(32)` | `NOT NULL`, `UNIQUE` | Уникальный бейдж |
| `PinHash` | `TEXT` | `NOT NULL`, `CHECK (bcrypt)` | Хэш PIN-кода |
| `Role` | `VARCHAR(20)` | `CHECK ('Admissions', 'PublicStaff')` | Роль сотрудника |
| `IsActive` | `BOOLEAN` | `DEFAULT TRUE` | Активен ли аккаунт |

---

## 7. Таблица `WardAlert` (Медицинские тревоги)
Журнал вызовов медсестры от прикроватных мониторов и кнопок вызова.

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `AlertID` | `VARCHAR(20)` | `PRIMARY KEY` | Идентификатор тревоги (напр. ALT-1001) |
| `WardID` | `INT` | `FOREIGN KEY (Ward)` | Палата, где возникла тревога |
| `PatientID` | `INT` | `FOREIGN KEY (Patient)` | Пациент, вызвавший тревогу |
| `Source` | `VARCHAR(20)` | `CHECK ('MONITOR', 'CALL_BUTTON')` | Источник тревоги |
| `Priority` | `VARCHAR(10)` | `CHECK ('LOW', 'HIGH', 'CRITICAL')` | Приоритет вызова |
| `Description` | `TEXT` | — | Описание / детали вызова |
| `Status` | `VARCHAR(20)` | `CHECK ('PENDING', 'ACKNOWLEDGED', 'ESCALATED')` | Состояние вызова |
| `AssignedNurseID` | `VARCHAR(20)`| `FOREIGN KEY (Nurse)` | Изначально назначенная медсестра |
| `EscalatedToNurseID` | `VARCHAR(20)`| `FOREIGN KEY (Nurse)` | Медсестра, которой эскалирован вызов |
| `AcknowledgedByNurseID`| `VARCHAR(20)`| `FOREIGN KEY (Nurse)` | Медсестра, принявшая вызов |
| `CreatedAt` | `TIMESTAMPTZ`| `DEFAULT CURRENT_TIMESTAMP` | Время возникновения тревоги |
| `EscalatedAt` | `TIMESTAMPTZ`| — | Время эскалации |
| `AcknowledgedAt` | `TIMESTAMPTZ`| — | Время принятия тревоги |
| `UpdatedAt` | `TIMESTAMPTZ`| `DEFAULT CURRENT_TIMESTAMP` | Время последнего обновления |

---

## 8. Таблица `AlertEvent` (Журнал аудита тревог)
Неизменяемый (Append-Only) журнал всех событий тревог. Заполняется триггером `fn_LogAlertEvents`.

| Столбец | Тип данных | Ограничения (Constraints) | Описание |
| :--- | :--- | :--- | :--- |
| `EventID` | `BIGSERIAL` | `PRIMARY KEY` | Порядковый номер события |
| `AlertID` | `VARCHAR(20)` | `FOREIGN KEY (WardAlert)` | Ссылка на тревогу |
| `EventType` | `VARCHAR(20)` | `CHECK ('CREATED', 'ASSIGNED', 'ESCALATED', 'ACKNOWLEDGED')` | Тип произошедшего события |
| `NurseID` | `VARCHAR(20)` | `FOREIGN KEY (Nurse)` | Медсестра, фигурирующая в событии |
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