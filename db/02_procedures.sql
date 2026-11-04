-- =============================================================================
-- Hospital Ward Management System (Team MedBase)
-- 02. Stored procedures (PL/pgSQL)
-- Requires: 01_schema.sql
-- =============================================================================

--------------------------------------------------------------------------------
-- Procedure 1: sp_AdmitPatient
-- Business Logic: Admitting a patient and assigning them to a ward bed (Task 09 Main Action)
-- Enforces: patient/ward existence and ward capacity limits.
-- Transfers: if the patient already has an Active admission in another ward,
-- that admission is closed (Discharged) before the new one is created.
-- Concurrency: patient and ward rows are locked (FOR UPDATE), so two parallel
-- admissions cannot both take the last free bed.
-- SECURITY DEFINER: row locks need UPDATE privilege on "Ward", which callers
-- (admissions staff) don't have; the procedure runs with the owner's rights.
--------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_AdmitPatient(
    p_PatientID INT,
    p_WardID INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ActiveAdmissions INT;
    v_Capacity INT;
    v_CurrentAdmissionID INT;
    v_CurrentWardID INT;
BEGIN
    -- 1. Verify Patient existence (lock the row to serialize admissions of one patient)
    PERFORM 1 FROM "Patient" WHERE "PatientID" = p_PatientID FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Patient ID % does not exist.', p_PatientID;
    END IF;

    -- 2. Verify Ward existence (lock the row so the capacity check below cannot race)
    SELECT "Capacity" INTO v_Capacity
    FROM "Ward"
    WHERE "WardID" = p_WardID
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ward ID % does not exist.', p_WardID;
    END IF;

    -- 3. Check the patient's current active admission
    SELECT "AdmissionID", "WardID" INTO v_CurrentAdmissionID, v_CurrentWardID
    FROM "Admission"
    WHERE "PatientID" = p_PatientID AND "Status" = 'Active';

    IF v_CurrentWardID = p_WardID THEN
        RAISE EXCEPTION 'Patient ID % is already admitted to Ward ID %.', p_PatientID, p_WardID;
    END IF;

    -- 4. Check current occupancy in the target ward
    SELECT COUNT(*) INTO v_ActiveAdmissions
    FROM "Admission"
    WHERE "WardID" = p_WardID AND "Status" = 'Active';

    IF v_ActiveAdmissions >= v_Capacity THEN
        RAISE EXCEPTION 'Ward ID % is full (Capacity: %, Occupied: %).', p_WardID, v_Capacity, v_ActiveAdmissions;
    END IF;

    -- 5. Transfer: close the previous admission
    IF v_CurrentAdmissionID IS NOT NULL THEN
        UPDATE "Admission"
        SET "Status" = 'Discharged',
            "DischargeDate" = CURRENT_DATE
        WHERE "AdmissionID" = v_CurrentAdmissionID;

        RAISE NOTICE 'Patient ID % transferred out of Ward ID %.', p_PatientID, v_CurrentWardID;
    END IF;

    -- 6. Admit patient
    INSERT INTO "Admission" ("PatientID", "WardID", "AdmitDate", "Status")
    VALUES (p_PatientID, p_WardID, CURRENT_DATE, 'Active');

    RAISE NOTICE 'Patient ID % successfully admitted to Ward ID %.', p_PatientID, p_WardID;
END;
$$;

--------------------------------------------------------------------------------
-- Procedure 2: sp_RegisterAndAdmitPatient
-- Business Logic: Admission transaction (Task 09, Student 5)
-- Step 1 inserts the Patient if they don't exist yet (matched by Phone),
-- step 2 creates the Admission. If step 2 fails (e.g. ward is full), the whole
-- CALL fails and step 1 is rolled back, so no patient is left without an admission.
--------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_RegisterAndAdmitPatient(
    p_FullName VARCHAR,
    p_DOB DATE,
    p_Phone VARCHAR,
    p_Gender VARCHAR,
    p_WardID INT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_PatientID INT;
BEGIN
    -- 1. Find existing patient by phone or register a new one
    SELECT "PatientID" INTO v_PatientID
    FROM "Patient"
    WHERE "Phone" = p_Phone;

    IF NOT FOUND THEN
        INSERT INTO "Patient" ("FullName", "DOB", "Phone", "Gender")
        VALUES (p_FullName, p_DOB, p_Phone, p_Gender)
        RETURNING "PatientID" INTO v_PatientID;

        RAISE NOTICE 'Registered new Patient ID % (%).', v_PatientID, p_FullName;
    END IF;

    -- 2. Admit (any exception here rolls back step 1 as well)
    CALL sp_AdmitPatient(v_PatientID, p_WardID);
END;
$$;

--------------------------------------------------------------------------------
-- Procedure 3: sp_DischargePatient
-- Business Logic: closing the patient's active admission (UC-3)
-- SECURITY DEFINER: same reason as sp_AdmitPatient (row locks).
--------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_DischargePatient(
    p_PatientID INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_AdmissionID INT;
    v_WardID INT;
BEGIN
    -- 1. Verify Patient existence (lock the row to serialize with admissions)
    PERFORM 1 FROM "Patient" WHERE "PatientID" = p_PatientID FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Patient ID % does not exist.', p_PatientID;
    END IF;

    -- 2. Find the active admission
    SELECT "AdmissionID", "WardID" INTO v_AdmissionID, v_WardID
    FROM "Admission"
    WHERE "PatientID" = p_PatientID AND "Status" = 'Active'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Patient ID % has no active admission.', p_PatientID;
    END IF;

    -- 3. Close it
    UPDATE "Admission"
    SET "Status" = 'Discharged',
        "DischargeDate" = CURRENT_DATE
    WHERE "AdmissionID" = v_AdmissionID;

    RAISE NOTICE 'Patient ID % discharged from Ward ID %.', p_PatientID, v_WardID;
END;
$$;

--------------------------------------------------------------------------------
-- Procedure 4: sp_RaiseAlert
-- Business Logic: a patient monitor or call button raises an alert (UC-5)
-- The backend chooses the nurse; the procedure re-checks that the choice is
-- valid (decisions.md, record 5). p_NurseID may be NULL when nobody in the ward
-- is on shift: such an alert is left for escalation.
-- Returns the new alert number in p_AlertID.
--------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_RaiseAlert(
    p_WardID INT,
    p_PatientID INT,
    p_Source VARCHAR,
    p_Priority VARCHAR,
    p_Description TEXT,
    p_NurseID VARCHAR,
    INOUT p_AlertID VARCHAR DEFAULT NULL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_NurseStatus VARCHAR(20);
BEGIN
    -- 1. Verify Ward existence
    PERFORM 1 FROM "Ward" WHERE "WardID" = p_WardID;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Ward ID % does not exist.', p_WardID;
    END IF;

    -- 2. The patient (if any) must be admitted to this ward right now
    IF p_PatientID IS NOT NULL THEN
        PERFORM 1 FROM "Admission"
        WHERE "PatientID" = p_PatientID AND "WardID" = p_WardID AND "Status" = 'Active';

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Patient ID % is not admitted to Ward ID %.', p_PatientID, p_WardID;
        END IF;
    END IF;

    -- 3. The nurse (if any) must exist, be on shift and work in this ward
    IF p_NurseID IS NOT NULL THEN
        SELECT "Status" INTO v_NurseStatus FROM "Nurse" WHERE "NurseID" = p_NurseID;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Nurse % does not exist.', p_NurseID;
        END IF;

        IF v_NurseStatus = 'OffShift' THEN
            RAISE EXCEPTION 'Nurse % is off shift.', p_NurseID;
        END IF;

        PERFORM 1 FROM "NurseAssignment" WHERE "NurseID" = p_NurseID AND "WardID" = p_WardID;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Nurse % is not assigned to Ward ID %.', p_NurseID, p_WardID;
        END IF;
    END IF;

    -- 4. Create the alert (the trigger logs CREATED and ASSIGNED)
    INSERT INTO "WardAlert" ("WardID", "PatientID", "Source", "Priority", "Description", "AssignedNurseID")
    VALUES (p_WardID, p_PatientID, p_Source, p_Priority, p_Description, p_NurseID)
    RETURNING "AlertID" INTO p_AlertID;

    RAISE NOTICE 'Alert % (%) raised in Ward ID %.', p_AlertID, p_Priority, p_WardID;
END;
$$;

--------------------------------------------------------------------------------
-- Procedure 5: sp_EscalateAlert
-- Business Logic: forwarding an unacknowledged alert to another nurse (UC-7)
-- The backend finds overdue alerts and picks the nurse; the procedure re-checks
-- the escalation rules (decisions.md, records 1 and 5):
-- only PENDING HIGH/CRITICAL alerts, at least 30 seconds old, to an Available nurse.
--------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_EscalateAlert(
    p_AlertID VARCHAR,
    p_ToNurseID VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_Alert "WardAlert"%ROWTYPE;
    v_NurseStatus VARCHAR(20);
    v_AgeSeconds INT;
BEGIN
    -- 1. Verify Alert existence (lock it so a parallel acknowledgement waits)
    SELECT * INTO v_Alert FROM "WardAlert" WHERE "AlertID" = p_AlertID FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Alert ID % does not exist.', p_AlertID;
    END IF;

    -- 2. Escalation rules
    IF v_Alert."Status" <> 'PENDING' THEN
        RAISE EXCEPTION 'Alert ID % is not pending (status %).', p_AlertID, v_Alert."Status";
    END IF;

    IF v_Alert."Priority" = 'LOW' THEN
        RAISE EXCEPTION 'Alert ID % has priority LOW; only HIGH and CRITICAL alerts are escalated.', p_AlertID;
    END IF;

    v_AgeSeconds := EXTRACT(EPOCH FROM CURRENT_TIMESTAMP - v_Alert."CreatedAt")::INT;
    IF v_AgeSeconds < 30 THEN
        RAISE EXCEPTION 'Alert ID % is not overdue yet (% s old, escalation after 30 s).', p_AlertID, v_AgeSeconds;
    END IF;

    -- 3. Target nurse must exist, be Available and differ from the assigned nurse
    SELECT "Status" INTO v_NurseStatus FROM "Nurse" WHERE "NurseID" = p_ToNurseID;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nurse % does not exist.', p_ToNurseID;
    END IF;

    IF v_NurseStatus <> 'Available' THEN
        RAISE EXCEPTION 'Nurse % is not Available (status %).', p_ToNurseID, v_NurseStatus;
    END IF;

    IF p_ToNurseID = v_Alert."AssignedNurseID" THEN
        RAISE EXCEPTION 'Nurse % is already assigned to alert %.', p_ToNurseID, p_AlertID;
    END IF;

    -- 4. Escalate (the trigger logs ESCALATED)
    UPDATE "WardAlert"
    SET "Status" = 'ESCALATED',
        "EscalatedToNurseID" = p_ToNurseID,
        "EscalatedAt" = CURRENT_TIMESTAMP,
        "UpdatedAt" = CURRENT_TIMESTAMP
    WHERE "AlertID" = p_AlertID;

    RAISE NOTICE 'Alert ID % escalated to Nurse %.', p_AlertID, p_ToNurseID;
END;
$$;

--------------------------------------------------------------------------------
-- Procedure 6: sp_AcknowledgeAlert
-- Business Logic: Nurse acknowledging an alert (UC-6, Lab 04 / Task 07 Main Action)
-- Allowed for the assigned nurse, the nurse it was escalated to, or any nurse
-- of the alert's ward who is on shift. The assigned nurse is not overwritten.
-- Acknowledging an already acknowledged alert is a no-op.
--------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_AcknowledgeAlert(
    p_AlertID VARCHAR,
    p_NurseID VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_Alert "WardAlert"%ROWTYPE;
    v_NurseStatus VARCHAR(20);
BEGIN
    -- 1. Verify Alert existence (lock it so a parallel escalation waits)
    SELECT * INTO v_Alert FROM "WardAlert" WHERE "AlertID" = p_AlertID FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Alert ID % does not exist.', p_AlertID;
    END IF;

    IF v_Alert."Status" = 'ACKNOWLEDGED' THEN
        RAISE NOTICE 'Alert ID % is already acknowledged.', p_AlertID;
        RETURN;
    END IF;

    -- 2. Nurse must exist and be on shift
    SELECT "Status" INTO v_NurseStatus FROM "Nurse" WHERE "NurseID" = p_NurseID;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nurse % does not exist.', p_NurseID;
    END IF;

    IF v_NurseStatus = 'OffShift' THEN
        RAISE EXCEPTION 'Nurse % is off shift.', p_NurseID;
    END IF;

    -- 3. Nurse must be responsible for the alert
    IF p_NurseID IS DISTINCT FROM v_Alert."AssignedNurseID"
       AND p_NurseID IS DISTINCT FROM v_Alert."EscalatedToNurseID"
       AND NOT EXISTS (SELECT 1 FROM "NurseAssignment"
                       WHERE "NurseID" = p_NurseID AND "WardID" = v_Alert."WardID") THEN
        RAISE EXCEPTION 'Nurse % cannot acknowledge alert % (not assigned to it or to Ward ID %).',
            p_NurseID, p_AlertID, v_Alert."WardID";
    END IF;

    -- 4. Acknowledge (the trigger logs ACKNOWLEDGED)
    UPDATE "WardAlert"
    SET "Status" = 'ACKNOWLEDGED',
        "AcknowledgedByNurseID" = p_NurseID,
        "AcknowledgedAt" = CURRENT_TIMESTAMP,
        "UpdatedAt" = CURRENT_TIMESTAMP
    WHERE "AlertID" = p_AlertID;

    RAISE NOTICE 'Alert ID % successfully acknowledged by Nurse %.', p_AlertID, p_NurseID;
END;
$$;

--------------------------------------------------------------------------------
-- Procedure 7: sp_SetNurseStatus
-- Business Logic: a nurse switches between Available / Busy / OffShift
-- (Available nurses are escalation targets). Invalid statuses fail on the CHECK.
--------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_SetNurseStatus(
    p_NurseID VARCHAR,
    p_Status VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE "Nurse" SET "Status" = p_Status WHERE "NurseID" = p_NurseID;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nurse % does not exist.', p_NurseID;
    END IF;

    RAISE NOTICE 'Nurse % is now %.', p_NurseID, p_Status;
END;
$$;

--------------------------------------------------------------------------------
-- Function 8: fn_AuthenticateStaff
-- Login with badge + PIN (Lab 05; the badge reader types the badge ID).
-- Returns the account (nurse or other staff) when the PIN matches, otherwise
-- no rows. The PIN is compared with the bcrypt hash inside the database, so no
-- application role ever needs to read PIN hashes.
-- SECURITY DEFINER: callers have no access to "PinHash".
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_AuthenticateStaff(
    p_BadgeID VARCHAR,
    p_Pin VARCHAR
)
RETURNS TABLE ("AccountID" VARCHAR, "FullName" VARCHAR, "Role" VARCHAR)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT n."NurseID", n."FullName", n."Role"
    FROM "Nurse" n
    WHERE n."BadgeID" = p_BadgeID AND n."PinHash" = crypt(p_Pin, n."PinHash")
    UNION ALL
    SELECT s."AccountID", s."FullName", s."Role"
    FROM "StaffAccount" s
    WHERE s."BadgeID" = p_BadgeID AND s."IsActive" AND s."PinHash" = crypt(p_Pin, s."PinHash");
$$;
