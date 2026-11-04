-- =============================================================================
-- Hospital Ward Management System (Team MedBase)
-- 03. Security: view, roles, privileges
-- Only doctors and admissions staff can access Patient / Admission data and
-- change admission status. Public staff only see ward capacity.
-- Nurses read alerts and acknowledge them; the alert service (backend worker
-- and device simulator) raises and escalates alerts. Alert changes go only
-- through procedures: no role can write to WardAlert / AlertEvent directly,
-- and nobody but the owner can read nurse PIN hashes.
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
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medbase_nurse') THEN
        CREATE ROLE medbase_nurse NOLOGIN;  -- ward nurses and head nurses
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medbase_alert_service') THEN
        CREATE ROLE medbase_alert_service NOLOGIN;  -- escalation worker, device simulator
    END IF;
END;
$$;

-- Procedures are executable by PUBLIC by default; restrict all of them
REVOKE EXECUTE ON PROCEDURE sp_AdmitPatient(INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON PROCEDURE sp_RegisterAndAdmitPatient(VARCHAR, DATE, VARCHAR, VARCHAR, INT) FROM PUBLIC;
REVOKE EXECUTE ON PROCEDURE sp_DischargePatient(INT) FROM PUBLIC;
REVOKE EXECUTE ON PROCEDURE sp_RaiseAlert(INT, INT, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON PROCEDURE sp_EscalateAlert(VARCHAR, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON PROCEDURE sp_AcknowledgeAlert(VARCHAR, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON PROCEDURE sp_SetNurseStatus(VARCHAR, VARCHAR) FROM PUBLIC;

-- Doctors & admissions staff
GRANT SELECT, INSERT, UPDATE ON "Patient", "Admission" TO medbase_admissions;
GRANT SELECT ON "Ward", "vw_WardCapacity" TO medbase_admissions;
GRANT USAGE ON SEQUENCE "Patient_PatientID_seq", "Admission_AdmissionID_seq" TO medbase_admissions;
GRANT EXECUTE ON PROCEDURE sp_AdmitPatient(INT, INT) TO medbase_admissions;
GRANT EXECUTE ON PROCEDURE sp_RegisterAndAdmitPatient(VARCHAR, DATE, VARCHAR, VARCHAR, INT) TO medbase_admissions;
GRANT EXECUTE ON PROCEDURE sp_DischargePatient(INT) TO medbase_admissions;

-- Public staff
GRANT SELECT ON "vw_WardCapacity" TO medbase_public_staff;

-- Nurses: read-only access to alerts, the journal and the nurse list (without PIN
-- hashes); the patient's name is visible so the nurse knows whom the alert is about
GRANT SELECT ON "WardAlert", "AlertEvent", "Ward", "NurseAssignment", "vw_WardCapacity" TO medbase_nurse;
GRANT SELECT ("NurseID", "FullName", "Role", "Status") ON "Nurse" TO medbase_nurse;
GRANT SELECT ("PatientID", "FullName") ON "Patient" TO medbase_nurse;
GRANT EXECUTE ON PROCEDURE sp_AcknowledgeAlert(VARCHAR, VARCHAR) TO medbase_nurse;
GRANT EXECUTE ON PROCEDURE sp_SetNurseStatus(VARCHAR, VARCHAR) TO medbase_nurse;

-- Alert service: reads what it needs to choose a nurse and find overdue alerts
GRANT SELECT ON "WardAlert", "Ward", "NurseAssignment" TO medbase_alert_service;
GRANT SELECT ("NurseID", "FullName", "Role", "Status") ON "Nurse" TO medbase_alert_service;
GRANT SELECT ("PatientID", "WardID", "Status") ON "Admission" TO medbase_alert_service;
GRANT EXECUTE ON PROCEDURE sp_RaiseAlert(INT, INT, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR) TO medbase_alert_service;
GRANT EXECUTE ON PROCEDURE sp_EscalateAlert(VARCHAR, VARCHAR) TO medbase_alert_service;
