-- =============================================================================
-- Hospital Ward Management System (Team MedBase)
-- 01. Schema: tables, constraints, indexes, alert event log trigger
-- Target: Task 09 & Lab 04 / Task 07, DB v2 (docs/project-plan.md, stage 1)
-- =============================================================================

-- pgcrypto: bcrypt hashes for nurse PINs in seed data and tests
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Cleanup existing objects if re-running
DROP VIEW IF EXISTS "vw_WardCapacity";
DROP PROCEDURE IF EXISTS sp_RegisterAndAdmitPatient(VARCHAR, DATE, VARCHAR, VARCHAR, INT);
DROP PROCEDURE IF EXISTS sp_AdmitPatient(INT, INT);
DROP PROCEDURE IF EXISTS sp_DischargePatient(INT);
DROP PROCEDURE IF EXISTS sp_RaiseAlert(INT, INT, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR);
DROP PROCEDURE IF EXISTS sp_EscalateAlert(VARCHAR, VARCHAR);
DROP PROCEDURE IF EXISTS sp_AcknowledgeAlert(VARCHAR, VARCHAR);
DROP PROCEDURE IF EXISTS sp_SetNurseStatus(VARCHAR, VARCHAR);
DROP TABLE IF EXISTS "AlertEvent" CASCADE;
DROP TABLE IF EXISTS "WardAlert" CASCADE;
DROP TABLE IF EXISTS "NurseAssignment" CASCADE;
DROP TABLE IF EXISTS "Nurse" CASCADE;
DROP TABLE IF EXISTS "Admission" CASCADE;
DROP TABLE IF EXISTS "Ward" CASCADE;
DROP TABLE IF EXISTS "Patient" CASCADE;
DROP FUNCTION IF EXISTS fn_LogAlertEvents();
DROP FUNCTION IF EXISTS fn_AlertEventIsAppendOnly();

-- Table: Patient
CREATE TABLE "Patient" (
    "PatientID" SERIAL PRIMARY KEY,
    "FullName" VARCHAR(100) NOT NULL,
    "DOB" DATE NOT NULL,
    "Phone" VARCHAR(20) UNIQUE,
    "Gender" VARCHAR(10)
);

-- Table: Ward
CREATE TABLE "Ward" (
    "WardID" INT PRIMARY KEY,
    "WardName" VARCHAR(50) NOT NULL,
    "FloorNum" INT NOT NULL,
    "Capacity" INT NOT NULL CHECK ("Capacity" > 0),
    "WardType" VARCHAR(50) NOT NULL
    CONSTRAINT "CK_Ward_ValidType"
    CHECK ("WardType" IN (
        'Intensive Care',
        'General Medicine',
        'Surgery',
        'Emergency'
    ))
);

-- Table: Admission (Bridge Table for Patients <-> Wards)
-- ON DELETE RESTRICT: a patient or ward that still has admission history cannot be deleted
-- DischargeDate is set exactly when the admission is closed (discharge or transfer)
CREATE TABLE "Admission" (
    "AdmissionID" SERIAL PRIMARY KEY,
    "PatientID" INT NOT NULL REFERENCES "Patient"("PatientID") ON DELETE RESTRICT,
    "WardID" INT NOT NULL REFERENCES "Ward"("WardID") ON DELETE RESTRICT,
    "AdmitDate" DATE NOT NULL DEFAULT CURRENT_DATE,
    "DischargeDate" DATE,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK ("Status" IN ('Active', 'Discharged')),
    CONSTRAINT "CK_Admission_DischargeDate"
        CHECK ((("Status" = 'Discharged') = ("DischargeDate" IS NOT NULL))
               AND ("DischargeDate" IS NULL OR "DischargeDate" >= "AdmitDate"))
);

-- A patient can have at most one Active admission (cannot be in two wards at once)
CREATE UNIQUE INDEX "UX_Admission_OneActivePerPatient"
    ON "Admission" ("PatientID")
    WHERE "Status" = 'Active';

CREATE INDEX "IX_Admission_Ward_Status" ON "Admission" ("WardID", "Status");

-- Table: Nurse (ward nurses and head nurses, Lab 05: badge login with PIN fallback)
-- PinHash stores only a bcrypt hash; the check rejects a plain-text PIN
CREATE TABLE "Nurse" (
    "NurseID" VARCHAR(20) PRIMARY KEY,
    "FullName" VARCHAR(100) NOT NULL,
    "BadgeID" VARCHAR(32) NOT NULL UNIQUE,
    "PinHash" TEXT NOT NULL CONSTRAINT "CK_Nurse_PinIsBcrypt" CHECK ("PinHash" ~ '^\$2[aby]\$\d{2}\$.{53}$'),
    "Role" VARCHAR(20) NOT NULL DEFAULT 'Nurse' CHECK ("Role" IN ('Nurse', 'HeadNurse')),
    "Status" VARCHAR(20) NOT NULL DEFAULT 'OffShift' CHECK ("Status" IN ('Available', 'Busy', 'OffShift'))
);

-- Table: NurseAssignment (which nurses work in which ward; shifts come from seed data)
-- The primary nurse of a ward receives its alerts first
CREATE TABLE "NurseAssignment" (
    "NurseID" VARCHAR(20) NOT NULL REFERENCES "Nurse"("NurseID") ON DELETE RESTRICT,
    "WardID" INT NOT NULL REFERENCES "Ward"("WardID") ON DELETE RESTRICT,
    "IsPrimary" BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY ("NurseID", "WardID")
);

-- At most one primary nurse per ward
CREATE UNIQUE INDEX "UX_NurseAssignment_OnePrimaryPerWard"
    ON "NurseAssignment" ("WardID")
    WHERE "IsPrimary";

-- Table: WardAlert (patient-care alerts for the nurse workstation, Lab 04 / Task 07)
-- The assigned nurse is kept separately from the nurse who acknowledged the alert,
-- so the response time and the escalation path can be reconstructed later.
CREATE TABLE "WardAlert" (
    "AlertID" VARCHAR(20) PRIMARY KEY,
    "WardID" INT NOT NULL REFERENCES "Ward"("WardID") ON DELETE RESTRICT,
    "PatientID" INT REFERENCES "Patient"("PatientID") ON DELETE RESTRICT,
    "Source" VARCHAR(20) NOT NULL CHECK ("Source" IN ('MONITOR', 'CALL_BUTTON')),
    "Priority" VARCHAR(10) NOT NULL CHECK ("Priority" IN ('LOW', 'HIGH', 'CRITICAL')),
    "Description" TEXT,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK ("Status" IN ('PENDING', 'ACKNOWLEDGED', 'ESCALATED')),
    "AssignedNurseID" VARCHAR(20) REFERENCES "Nurse"("NurseID") ON DELETE RESTRICT,
    "EscalatedToNurseID" VARCHAR(20) REFERENCES "Nurse"("NurseID") ON DELETE RESTRICT,
    "AcknowledgedByNurseID" VARCHAR(20) REFERENCES "Nurse"("NurseID") ON DELETE RESTRICT,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "EscalatedAt" TIMESTAMPTZ,
    "AcknowledgedAt" TIMESTAMPTZ,
    "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Acknowledged exactly when the acknowledging nurse and time are recorded
    CONSTRAINT "CK_WardAlert_Acknowledged"
        CHECK ((("Status" = 'ACKNOWLEDGED') = ("AcknowledgedByNurseID" IS NOT NULL))
               AND (("AcknowledgedByNurseID" IS NULL) = ("AcknowledgedAt" IS NULL))),
    -- Escalation target and time go together; ESCALATED requires them
    CONSTRAINT "CK_WardAlert_Escalated"
        CHECK ((("EscalatedToNurseID" IS NULL) = ("EscalatedAt" IS NULL))
               AND ("Status" <> 'ESCALATED' OR "EscalatedToNurseID" IS NOT NULL)),
    -- Only HIGH and CRITICAL alerts are escalated (decisions.md, record 1)
    CONSTRAINT "CK_WardAlert_NoLowEscalation"
        CHECK ("EscalatedToNurseID" IS NULL OR "Priority" <> 'LOW'),
    CONSTRAINT "CK_WardAlert_Timeline"
        CHECK (("EscalatedAt" IS NULL OR "EscalatedAt" >= "CreatedAt")
               AND ("AcknowledgedAt" IS NULL OR "AcknowledgedAt" >= "CreatedAt"))
);

-- Alert numbers: ALT-1001, ALT-1002, ...
CREATE SEQUENCE "WardAlert_AlertNo_seq" START 1001 OWNED BY "WardAlert"."AlertID";
ALTER TABLE "WardAlert"
    ALTER COLUMN "AlertID" SET DEFAULT 'ALT-' || nextval('"WardAlert_AlertNo_seq"');

CREATE INDEX "IX_WardAlert_Status_Created" ON "WardAlert" ("Status", "CreatedAt");

-- Table: AlertEvent (append-only journal of every alert step, decisions.md record 1)
CREATE TABLE "AlertEvent" (
    "EventID" BIGSERIAL PRIMARY KEY,
    "AlertID" VARCHAR(20) NOT NULL REFERENCES "WardAlert"("AlertID") ON DELETE RESTRICT,
    "EventType" VARCHAR(20) NOT NULL CHECK ("EventType" IN ('CREATED', 'ASSIGNED', 'ESCALATED', 'ACKNOWLEDGED')),
    "NurseID" VARCHAR(20) REFERENCES "Nurse"("NurseID") ON DELETE RESTRICT,
    "OccurredAt" TIMESTAMPTZ NOT NULL
);

CREATE INDEX "IX_AlertEvent_Alert" ON "AlertEvent" ("AlertID", "OccurredAt");

-- The journal is written by a trigger on WardAlert, so every change is logged
-- no matter which code made it (second protection layer, decisions.md record 5)
CREATE FUNCTION fn_LogAlertEvents()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO "AlertEvent" ("AlertID", "EventType", "NurseID", "OccurredAt")
        VALUES (NEW."AlertID", 'CREATED', NULL, NEW."CreatedAt");
    END IF;

    IF NEW."AssignedNurseID" IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW."AssignedNurseID" IS DISTINCT FROM OLD."AssignedNurseID") THEN
        INSERT INTO "AlertEvent" ("AlertID", "EventType", "NurseID", "OccurredAt")
        VALUES (NEW."AlertID", 'ASSIGNED', NEW."AssignedNurseID",
                CASE WHEN TG_OP = 'INSERT' THEN NEW."CreatedAt" ELSE NEW."UpdatedAt" END);
    END IF;

    IF NEW."EscalatedToNurseID" IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD."EscalatedToNurseID" IS NULL) THEN
        INSERT INTO "AlertEvent" ("AlertID", "EventType", "NurseID", "OccurredAt")
        VALUES (NEW."AlertID", 'ESCALATED', NEW."EscalatedToNurseID", NEW."EscalatedAt");
    END IF;

    IF NEW."AcknowledgedByNurseID" IS NOT NULL
       AND (TG_OP = 'INSERT' OR OLD."AcknowledgedByNurseID" IS NULL) THEN
        INSERT INTO "AlertEvent" ("AlertID", "EventType", "NurseID", "OccurredAt")
        VALUES (NEW."AlertID", 'ACKNOWLEDGED', NEW."AcknowledgedByNurseID", NEW."AcknowledgedAt");
    END IF;

    RETURN NULL;
END;
$$;

CREATE TRIGGER "TR_WardAlert_LogEvents"
    AFTER INSERT OR UPDATE ON "WardAlert"
    FOR EACH ROW EXECUTE FUNCTION fn_LogAlertEvents();

-- Journal rows can never be changed or deleted, even by the table owner
CREATE FUNCTION fn_AlertEventIsAppendOnly()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'AlertEvent is append-only: % is not allowed.', TG_OP;
END;
$$;

CREATE TRIGGER "TR_AlertEvent_AppendOnly"
    BEFORE UPDATE OR DELETE ON "AlertEvent"
    FOR EACH ROW EXECUTE FUNCTION fn_AlertEventIsAppendOnly();
