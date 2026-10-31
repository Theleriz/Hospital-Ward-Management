-- =============================================================================
-- Hospital Ward Management System (Team MedBase)
-- Automated tests: constraints, procedures, transfers, transaction rollback, roles
-- Requires: setup.sql (schema + procedures + security + seed)
-- Everything runs inside one transaction and is ROLLED BACK at the end,
-- so the database is left exactly as it was.
-- Run:  psql -v ON_ERROR_STOP=1 -f tests/test_hospital_ward.sql
-- Stops at the first FAIL; prints "ALL TESTS PASSED" on success.
-- =============================================================================

\set QUIET on
BEGIN;

-- Hide procedure NOTICEs; test results are printed as INFO (always shown)
SET LOCAL client_min_messages = warning;

-- -----------------------------------------------------------------------------
-- Test helpers (temporary, disappear with the session)
-- -----------------------------------------------------------------------------

-- Statement must succeed (optionally as another role)
CREATE PROCEDURE pg_temp.expect_ok(p_name TEXT, p_sql TEXT, p_role TEXT DEFAULT NULL)
LANGUAGE plpgsql AS $$
BEGIN
    IF p_role IS NOT NULL THEN
        EXECUTE format('SET LOCAL ROLE %I', p_role);
    END IF;
    EXECUTE p_sql;
    RESET ROLE;
    RAISE INFO 'PASS  %', p_name;
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL  %: unexpected error: %', p_name, SQLERRM;
END;
$$;

-- Statement must fail with an error message matching p_pattern (LIKE)
CREATE PROCEDURE pg_temp.expect_error(p_name TEXT, p_sql TEXT, p_pattern TEXT, p_role TEXT DEFAULT NULL)
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        IF p_role IS NOT NULL THEN
            EXECUTE format('SET LOCAL ROLE %I', p_role);
        END IF;
        EXECUTE p_sql;
        RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE p_pattern THEN
            RAISE INFO 'PASS  %', p_name;
            RETURN;
        END IF;
        RAISE EXCEPTION 'FAIL  %: expected error like "%", got: %', p_name, p_pattern, SQLERRM;
    END;
    RAISE EXCEPTION 'FAIL  %: expected error like "%", but statement succeeded', p_name, p_pattern;
END;
$$;

-- Query must return TRUE
CREATE PROCEDURE pg_temp.expect_true(p_name TEXT, p_sql TEXT)
LANGUAGE plpgsql AS $$
DECLARE
    v_Result BOOLEAN;
BEGIN
    EXECUTE p_sql INTO v_Result;
    IF v_Result IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'FAIL  %: condition is not true: %', p_name, p_sql;
    END IF;
    RAISE INFO 'PASS  %', p_name;
END;
$$;

-- -----------------------------------------------------------------------------
-- 0. Seed state
-- -----------------------------------------------------------------------------
CALL pg_temp.expect_true('seed: 8 patients, 4 wards, 6 admissions, 4 alerts', $q$
    SELECT (SELECT COUNT(*) FROM "Patient") = 8
       AND (SELECT COUNT(*) FROM "Ward") = 4
       AND (SELECT COUNT(*) FROM "Admission") = 6
       AND (SELECT COUNT(*) FROM "WardAlert") = 4 $q$);

CALL pg_temp.expect_true('view: ward 101 is full, ward 102 has 2 free beds', $q$
    SELECT (SELECT "AvailableBeds" FROM "vw_WardCapacity" WHERE "WardID" = 101) = 0
       AND (SELECT "AvailableBeds" FROM "vw_WardCapacity" WHERE "WardID" = 102) = 2 $q$);

-- -----------------------------------------------------------------------------
-- 1. Constraints (PK / FK / CHECK / UNIQUE / NOT NULL)
-- -----------------------------------------------------------------------------
CALL pg_temp.expect_error('Ward.Capacity must be > 0', $q$
    INSERT INTO "Ward" VALUES (200, 'Bad Ward', 1, 0, 'Surgery') $q$,
    '%violates check constraint%');

CALL pg_temp.expect_error('Ward.WardType is required', $q$
    INSERT INTO "Ward" VALUES (200, 'Bad Ward', 1, 2, NULL) $q$,
    '%violates not-null constraint%');

CALL pg_temp.expect_error('Patient.DOB is required', $q$
    INSERT INTO "Patient" ("FullName", "Phone") VALUES ('No DOB', '+70000000001') $q$,
    '%violates not-null constraint%');

CALL pg_temp.expect_error('Patient.Phone is unique', $q$
    INSERT INTO "Patient" ("FullName", "DOB", "Phone") VALUES ('Dup', '2000-01-01', '+77015550101') $q$,
    '%duplicate key%');

CALL pg_temp.expect_error('Admission.Status only Active/Discharged', $q$
    UPDATE "Admission" SET "Status" = 'Transferred' WHERE "AdmissionID" = 1 $q$,
    '%violates check constraint%');

CALL pg_temp.expect_error('Admission FK: patient must exist', $q$
    INSERT INTO "Admission" ("PatientID", "WardID") VALUES (999, 104) $q$,
    '%violates foreign key constraint%');

CALL pg_temp.expect_error('ON DELETE RESTRICT: ward with admissions', $q$
    DELETE FROM "Ward" WHERE "WardID" = 101 $q$,
    '%violates foreign key constraint%');

CALL pg_temp.expect_error('ON DELETE RESTRICT: patient with admissions', $q$
    DELETE FROM "Patient" WHERE "PatientID" = 1 $q$,
    '%violates foreign key constraint%');

CALL pg_temp.expect_error('one Active admission per patient (direct insert)', $q$
    INSERT INTO "Admission" ("PatientID", "WardID") VALUES (1, 104) $q$,
    '%duplicate key%UX_Admission_OneActivePerPatient%');

-- -----------------------------------------------------------------------------
-- 2. sp_AdmitPatient
-- -----------------------------------------------------------------------------
CALL pg_temp.expect_ok('admit patient 7 to ward 102', $q$ CALL sp_AdmitPatient(7, 102) $q$);

CALL pg_temp.expect_true('ward 102 occupancy is now 3', $q$
    SELECT "CurrentOccupancy" = 3 FROM "vw_WardCapacity" WHERE "WardID" = 102 $q$);

CALL pg_temp.expect_true('new admission is Active with today''s date', $q$
    SELECT "Status" = 'Active' AND "AdmitDate" = CURRENT_DATE
    FROM "Admission" WHERE "PatientID" = 7 $q$);

CALL pg_temp.expect_error('full ward is rejected', $q$ CALL sp_AdmitPatient(8, 101) $q$,
    'Ward ID 101 is full%');

CALL pg_temp.expect_error('same ward twice is rejected', $q$ CALL sp_AdmitPatient(1, 101) $q$,
    'Patient ID 1 is already admitted to Ward ID 101%');

CALL pg_temp.expect_error('unknown patient is rejected', $q$ CALL sp_AdmitPatient(999, 104) $q$,
    'Patient ID 999 does not exist%');

CALL pg_temp.expect_error('unknown ward is rejected', $q$ CALL sp_AdmitPatient(8, 999) $q$,
    'Ward ID 999 does not exist%');

-- -----------------------------------------------------------------------------
-- 3. Transfers (auto-close previous admission)
-- -----------------------------------------------------------------------------
CALL pg_temp.expect_ok('transfer patient 3 from ward 102 to 103', $q$ CALL sp_AdmitPatient(3, 103) $q$);

CALL pg_temp.expect_true('patient 3: old admission Discharged, only one Active (ward 103)', $q$
    SELECT (SELECT "Status" FROM "Admission" WHERE "AdmissionID" = 3) = 'Discharged'
       AND (SELECT array_agg("WardID") FROM "Admission"
            WHERE "PatientID" = 3 AND "Status" = 'Active') = ARRAY[103] $q$);

CALL pg_temp.expect_error('transfer into full ward is rejected', $q$ CALL sp_AdmitPatient(4, 101) $q$,
    'Ward ID 101 is full%');

CALL pg_temp.expect_true('failed transfer keeps patient 4 Active in ward 102', $q$
    SELECT "WardID" = 102 FROM "Admission" WHERE "PatientID" = 4 AND "Status" = 'Active' $q$);

-- -----------------------------------------------------------------------------
-- 4. sp_RegisterAndAdmitPatient (admission transaction)
-- -----------------------------------------------------------------------------
CALL pg_temp.expect_ok('register new patient and admit to ward 104', $q$
    CALL sp_RegisterAndAdmitPatient('Dana Seitkali', '1990-02-14', '+77015550109', 'Female', 104) $q$);

CALL pg_temp.expect_true('new patient exists and is Active in ward 104', $q$
    SELECT a."WardID" = 104
    FROM "Patient" p JOIN "Admission" a ON a."PatientID" = p."PatientID" AND a."Status" = 'Active'
    WHERE p."Phone" = '+77015550109' $q$);

CALL pg_temp.expect_ok('existing phone reuses patient 8', $q$
    CALL sp_RegisterAndAdmitPatient('Anna Petrova', '1988-06-18', '+77015550108', 'Female', 104) $q$);

CALL pg_temp.expect_true('no duplicate patient created, patient 8 Active in ward 104', $q$
    SELECT (SELECT COUNT(*) FROM "Patient" WHERE "Phone" = '+77015550108') = 1
       AND (SELECT "WardID" FROM "Admission" WHERE "PatientID" = 8 AND "Status" = 'Active') = 104 $q$);

CALL pg_temp.expect_error('new patient to full ward fails', $q$
    CALL sp_RegisterAndAdmitPatient('Timur Abenov', '1983-09-09', '+77015550110', 'Male', 101) $q$,
    'Ward ID 101 is full%');

CALL pg_temp.expect_true('rollback: failed registration left no patient behind', $q$
    SELECT NOT EXISTS (SELECT 1 FROM "Patient" WHERE "Phone" = '+77015550110') $q$);

-- -----------------------------------------------------------------------------
-- 5. sp_AcknowledgeAlert
-- -----------------------------------------------------------------------------
CALL pg_temp.expect_ok('acknowledge pending alert ALT-1001', $q$
    CALL sp_AcknowledgeAlert('ALT-1001', 'NURSE-03') $q$);

CALL pg_temp.expect_true('ALT-1001 is ACKNOWLEDGED by NURSE-03', $q$
    SELECT "Status" = 'ACKNOWLEDGED' AND "NurseID" = 'NURSE-03'
    FROM "WardAlert" WHERE "AlertID" = 'ALT-1001' $q$);

CALL pg_temp.expect_ok('acknowledge escalated alert ALT-1003', $q$
    CALL sp_AcknowledgeAlert('ALT-1003', 'NURSE-04') $q$);

CALL pg_temp.expect_ok('re-acknowledging ALT-1002 is a no-op', $q$
    CALL sp_AcknowledgeAlert('ALT-1002', 'NURSE-99') $q$);

CALL pg_temp.expect_true('ALT-1002 keeps original nurse NURSE-01', $q$
    SELECT "NurseID" = 'NURSE-01' FROM "WardAlert" WHERE "AlertID" = 'ALT-1002' $q$);

CALL pg_temp.expect_error('unknown alert is rejected', $q$
    CALL sp_AcknowledgeAlert('ALT-9999', 'NURSE-01') $q$,
    'Alert ID ALT-9999 does not exist%');

-- -----------------------------------------------------------------------------
-- 6. Security (roles)
-- -----------------------------------------------------------------------------
CALL pg_temp.expect_ok('public staff can read ward capacity view',
    $q$ SELECT * FROM "vw_WardCapacity" $q$, 'medbase_public_staff');

CALL pg_temp.expect_error('public staff cannot read Patient',
    $q$ SELECT * FROM "Patient" $q$, 'permission denied%', 'medbase_public_staff');

CALL pg_temp.expect_error('public staff cannot read Admission',
    $q$ SELECT * FROM "Admission" $q$, 'permission denied%', 'medbase_public_staff');

CALL pg_temp.expect_error('public staff cannot admit patients',
    $q$ CALL sp_AdmitPatient(5, 103) $q$, 'permission denied%', 'medbase_public_staff');

CALL pg_temp.expect_ok('admissions staff can read Patient',
    $q$ SELECT * FROM "Patient" $q$, 'medbase_admissions');

CALL pg_temp.expect_ok('admissions staff can admit patients',
    $q$ CALL sp_AdmitPatient(5, 103) $q$, 'medbase_admissions');

CALL pg_temp.expect_ok('admissions staff can register and admit',
    $q$ CALL sp_RegisterAndAdmitPatient('Role Test', '2000-01-01', '+77015550111', 'Male', 103) $q$,
    'medbase_admissions');

CALL pg_temp.expect_error('admissions staff cannot delete patients',
    $q$ DELETE FROM "Patient" WHERE "PatientID" = 6 $q$, 'permission denied%', 'medbase_admissions');

CALL pg_temp.expect_error('admissions staff cannot change ward capacity',
    $q$ UPDATE "Ward" SET "Capacity" = 10 WHERE "WardID" = 101 $q$, 'permission denied%', 'medbase_admissions');

-- -----------------------------------------------------------------------------
DO $$ BEGIN RAISE INFO 'ALL TESTS PASSED'; END $$;
ROLLBACK;
