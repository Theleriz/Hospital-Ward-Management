-- Repeatable demo configuration. Reuses the existing synthetic E2E records;
-- it intentionally does not create accounts or patients and does not clear data.
-- Run only on medbase_pews_stage2_test on port 55444.
\set ON_ERROR_STOP on

DO $$
BEGIN
    IF current_database() <> 'medbase_pews_stage2_test'
       OR inet_server_port() <> 55444 THEN
        RAISE EXCEPTION 'Refusing demo setup outside medbase_pews_stage2_test on port 55444';
    END IF;
END;
$$;

\ir migrations/20261125_add_paediatrics_ward.sql

BEGIN;

DO $$
DECLARE
    expected_patients INT;
BEGIN
    SELECT count(*) INTO expected_patients
    FROM "Patient"
    WHERE "Phone" IN (
        '+77010009901', '+77010009902', '+77010009903',
        '+77010009904', '+77010009905'
    );
    IF expected_patients <> 5 THEN
        RAISE EXCEPTION 'Expected all five existing synthetic E2E patients; found %', expected_patients;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM "Nurse" WHERE "NurseID" = 'NURSE-E2E') THEN
        RAISE EXCEPTION 'Existing synthetic nurse NURSE-E2E is missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "StaffAccount"
        WHERE "AccountID" = 'DOC-E2E-A' AND "Role" = 'Doctor' AND "IsActive"
    ) OR NOT EXISTS (
        SELECT 1 FROM "StaffAccount"
        WHERE "AccountID" = 'DOC-E2E-B' AND "Role" = 'Doctor' AND "IsActive"
    ) THEN
        RAISE EXCEPTION 'Existing synthetic Doctor A and Doctor B accounts are required';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "Ward"
        WHERE "WardID" = 105 AND "WardName" = 'Детская палата' AND "WardType" = 'Paediatrics'
    ) THEN
        RAISE EXCEPTION 'Permanent paediatric ward 105 is unavailable';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "NurseAssignment"
        WHERE "WardID" = 105 AND "IsPrimary" AND "NurseID" <> 'NURSE-E2E'
    ) THEN
        RAISE EXCEPTION 'Another primary nurse is already assigned to demo paediatric ward';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "DoctorPatientAssignment" dpa
        JOIN "Patient" p ON p."PatientID" = dpa."PatientID"
        WHERE dpa."DoctorAccountID" = 'DOC-E2E-B'
          AND p."Phone" IN (
              '+77010009901', '+77010009902', '+77010009903',
              '+77010009904', '+77010009905'
          )
    ) THEN
        RAISE EXCEPTION 'Doctor B is already assigned to a demo patient; refusing to broaden demo access';
    END IF;
END;
$$;

-- Keep one active admission per pediatric demo patient; move an existing active row or
-- add it when absent, instead of creating duplicates on repeated runs.
WITH target("Phone", "WardID") AS (VALUES
    ('+77010009901', 105),
    ('+77010009902', 105),
    ('+77010009903', 105)
)
UPDATE "Admission" a
SET "WardID" = t."WardID"
FROM target t JOIN "Patient" p ON p."Phone" = t."Phone"
WHERE a."PatientID" = p."PatientID" AND a."Status" = 'Active';

WITH target("Phone", "WardID") AS (VALUES
    ('+77010009901', 105),
    ('+77010009902', 105),
    ('+77010009903', 105)
)
INSERT INTO "Admission" ("PatientID", "WardID", "AdmitDate", "Status")
SELECT p."PatientID", t."WardID", CURRENT_DATE, 'Active'
FROM target t JOIN "Patient" p ON p."Phone" = t."Phone"
WHERE NOT EXISTS (
    SELECT 1 FROM "Admission" a
    WHERE a."PatientID" = p."PatientID" AND a."Status" = 'Active'
);

INSERT INTO "NurseAssignment" ("NurseID", "WardID", "IsPrimary")
VALUES ('NURSE-E2E', 105, TRUE)
ON CONFLICT ("NurseID", "WardID") DO UPDATE SET "IsPrimary" = TRUE;

INSERT INTO "DoctorPatientAssignment" ("DoctorAccountID", "PatientID")
SELECT 'DOC-E2E-A', p."PatientID"
FROM "Patient" p
WHERE p."Phone" IN (
    '+77010009901', '+77010009902', '+77010009903',
    '+77010009904', '+77010009905'
)
ON CONFLICT ("DoctorAccountID", "PatientID") DO NOTHING;

COMMIT;

-- Verification output: three active pediatric admissions, five assignments for Doctor A,
-- and no assignments for Doctor B.
SELECT current_database() AS database_name, inet_server_port() AS port;
SELECT w."WardName", w."WardType", p."FullName", a."Status"
FROM "Patient" p
JOIN "Admission" a ON a."PatientID" = p."PatientID" AND a."Status" = 'Active'
JOIN "Ward" w ON w."WardID" = a."WardID"
WHERE p."Phone" IN (
    '+77010009901', '+77010009902', '+77010009903'
)
ORDER BY p."Phone";
SELECT d."AccountID", count(p."PatientID") AS assigned_demo_patients
FROM "StaffAccount" d
LEFT JOIN "DoctorPatientAssignment" x ON x."DoctorAccountID" = d."AccountID"
LEFT JOIN "Patient" p ON p."PatientID" = x."PatientID"
    AND p."Phone" IN (
        '+77010009901', '+77010009902', '+77010009903',
        '+77010009904', '+77010009905'
    )
WHERE d."AccountID" IN ('DOC-E2E-A', 'DOC-E2E-B')
GROUP BY d."AccountID"
ORDER BY d."AccountID";
