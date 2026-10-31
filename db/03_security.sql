-- =============================================================================
-- Hospital Ward Management System (Team MedBase)
-- 03. Security: view, roles, privileges
-- Only doctors and admissions staff can access Patient / Admission data and
-- change admission status. Public staff only see ward capacity.
-- Requires: 01_schema.sql, 02_procedures.sql
-- =============================================================================

-- Ward capacity view for public staff (no patient data)
CREATE OR REPLACE VIEW "vw_WardCapacity" AS
SELECT
    w."WardID",
    w."WardName",
    w."FloorNum",
    w."WardType",
    w."Capacity",
    COUNT(a."AdmissionID") AS "CurrentOccupancy",
    w."Capacity" - COUNT(a."AdmissionID") AS "AvailableBeds"
FROM "Ward" w
LEFT JOIN "Admission" a ON w."WardID" = a."WardID" AND a."Status" = 'Active'
GROUP BY w."WardID", w."WardName", w."FloorNum", w."WardType", w."Capacity";

-- Roles are cluster-wide, so create them only if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medbase_admissions') THEN
        CREATE ROLE medbase_admissions NOLOGIN;  -- doctors & admissions staff
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medbase_public_staff') THEN
        CREATE ROLE medbase_public_staff NOLOGIN;  -- other hospital staff
    END IF;
END;
$$;

-- Procedures are executable by PUBLIC by default; restrict admission procedures
REVOKE EXECUTE ON PROCEDURE sp_AdmitPatient(INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON PROCEDURE sp_RegisterAndAdmitPatient(VARCHAR, DATE, VARCHAR, VARCHAR, INT) FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE ON "Patient", "Admission" TO medbase_admissions;
GRANT SELECT ON "Ward", "vw_WardCapacity" TO medbase_admissions;
GRANT USAGE ON SEQUENCE "Patient_PatientID_seq", "Admission_AdmissionID_seq" TO medbase_admissions;
GRANT EXECUTE ON PROCEDURE sp_AdmitPatient(INT, INT) TO medbase_admissions;
GRANT EXECUTE ON PROCEDURE sp_RegisterAndAdmitPatient(VARCHAR, DATE, VARCHAR, VARCHAR, INT) TO medbase_admissions;

GRANT SELECT ON "vw_WardCapacity" TO medbase_public_staff;
