-- =============================================================================
-- Hospital Ward Management System (Team MedBase)
-- 03. Security: view, roles, privileges
-- Only doctors and admissions staff can access Patient / Admission data and
-- change admission status. Public staff only see ward capacity.
-- Nurses read alerts and acknowledge them; the head nurse additionally reads
-- the response-time report and the alert journal (UC-8). The alert service
-- (backend worker and device simulator) raises and escalates alerts. Alert changes go only
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

-- Head nurse report (UC-8): one row per alert with the response time
-- (acknowledgement minus creation, FR-29) and whether it was escalated (FR-30).
-- Staff performance data without patient data: no patient name or ID.
CREATE OR REPLACE VIEW "vw_AlertResponse" AS
SELECT
    a."AlertID",
    a."WardID",
    w."WardName",
    a."Source",
    a."Priority",
    a."Description",
    a."Status",
    a."AssignedNurseID",
    na."FullName" AS "AssignedNurseName",
    a."EscalatedToNurseID",
    ne."FullName" AS "EscalatedToNurseName",
    a."AcknowledgedByNurseID",
    nk."FullName" AS "AcknowledgedByNurseName",
    a."CreatedAt",
    a."EscalatedAt",
    a."AcknowledgedAt",
    a."AcknowledgedAt" - a."CreatedAt" AS "ResponseTime",
    EXTRACT(EPOCH FROM a."AcknowledgedAt" - a."CreatedAt")::NUMERIC(10, 1) AS "ResponseSeconds",
    a."EscalatedToNurseID" IS NOT NULL AS "WasEscalated"
FROM "WardAlert" a
JOIN "Ward" w ON w."WardID" = a."WardID"
LEFT JOIN "Nurse" na ON na."NurseID" = a."AssignedNurseID"
LEFT JOIN "Nurse" ne ON ne."NurseID" = a."EscalatedToNurseID"
LEFT JOIN "Nurse" nk ON nk."NurseID" = a."AcknowledgedByNurseID";

-- Cluster-wide roles and memberships (also used by scripts/restore-db.sh)
\ir 00_roles.sql

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

-- Doctor access is granted only to assignment-filtered SECURITY DEFINER
-- functions by the additive staff-review migration.

-- Public staff
GRANT SELECT ON "vw_WardCapacity" TO medbase_public_staff;

-- Nurses: read-only access to alerts and the nurse list (without PIN hashes);
-- the patient's name is visible so the nurse knows whom the alert is about
GRANT SELECT ON "WardAlert", "Ward", "NurseAssignment", "vw_WardCapacity" TO medbase_nurse;
GRANT SELECT, INSERT ON "StaffReviewRequest" TO medbase_nurse;
GRANT USAGE ON SEQUENCE "StaffReviewRequest_RequestID_seq" TO medbase_nurse;
GRANT SELECT ("NurseID", "FullName", "Role", "Status") ON "Nurse" TO medbase_nurse;
GRANT SELECT ("PatientID", "FullName") ON "Patient" TO medbase_nurse;
GRANT EXECUTE ON PROCEDURE sp_AcknowledgeAlert(VARCHAR, VARCHAR) TO medbase_nurse;
GRANT EXECUTE ON PROCEDURE sp_SetNurseStatus(VARCHAR, VARCHAR) TO medbase_nurse;
-- A nurse who was called for an alert keeps seeing it after the next escalation
-- (decisions.md, record 13): only who was called, not the full journal with times
GRANT SELECT ("AlertID", "EventType", "NurseID") ON "AlertEvent" TO medbase_nurse;

-- Head nurse: the response-time report and the full alert journal (UC-8, FR-31);
-- ward nurses do not get them
GRANT SELECT ON "vw_AlertResponse", "AlertEvent" TO medbase_head_nurse;

-- Alert service: reads what it needs to choose a nurse and find overdue alerts.
-- The device simulator shows which patient lies in which ward (name only).
GRANT SELECT ON "WardAlert", "Ward", "NurseAssignment" TO medbase_alert_service;
GRANT SELECT ("NurseID", "FullName", "Role", "Status") ON "Nurse" TO medbase_alert_service;
GRANT SELECT ("PatientID", "WardID", "Status") ON "Admission" TO medbase_alert_service;
GRANT SELECT ("PatientID", "FullName") ON "Patient" TO medbase_alert_service;
-- Who was already called for an alert, so nobody is called twice (decisions.md, record 12)
GRANT SELECT ("AlertID", "EventType", "NurseID") ON "AlertEvent" TO medbase_alert_service;
GRANT EXECUTE ON PROCEDURE sp_RaiseAlert(INT, INT, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR) TO medbase_alert_service;
GRANT EXECUTE ON PROCEDURE sp_EscalateAlert(VARCHAR, VARCHAR) TO medbase_alert_service;

-- Private verifier; 06_login_security.sql grants only the throttled entry point.
REVOKE EXECUTE ON FUNCTION fn_AuthenticateStaff(VARCHAR, VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_AuthenticateStaff(VARCHAR, VARCHAR) FROM medbase_api;
