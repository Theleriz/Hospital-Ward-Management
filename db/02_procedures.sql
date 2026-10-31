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
        SET "Status" = 'Discharged'
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
-- Procedure 3: sp_AcknowledgeAlert
-- Business Logic: Nurse acknowledging a high-priority alert (Lab 04 / Task 07 Main Action)
--------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sp_AcknowledgeAlert(
    p_AlertID VARCHAR,
    p_NurseID VARCHAR
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_AlertStatus VARCHAR(20);
BEGIN
    -- 1. Verify Alert existence
    SELECT "Status" INTO v_AlertStatus
    FROM "WardAlert"
    WHERE "AlertID" = p_AlertID;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Alert ID % does not exist.', p_AlertID;
    END IF;

    -- 2. Update status if pending/escalated
    IF v_AlertStatus = 'ACKNOWLEDGED' THEN
        RAISE NOTICE 'Alert ID % is already acknowledged.', p_AlertID;
        RETURN;
    END IF;

    UPDATE "WardAlert"
    SET "Status" = 'ACKNOWLEDGED',
        "NurseID" = p_NurseID,
        "UpdatedAt" = CURRENT_TIMESTAMP
    WHERE "AlertID" = p_AlertID;

    RAISE NOTICE 'Alert ID % successfully acknowledged by Nurse %.', p_AlertID, p_NurseID;
END;
$$;
