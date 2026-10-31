-- =============================================================================
-- Hospital Ward Management System (Team MedBase)
-- 05. Business queries & usage examples (read-only, safe to run any time)
-- Note: tables and columns were created with quotes ("Patient", "FullName"),
-- so they must always be written in quotes with the exact same case.
-- =============================================================================

-- Q1 (Task 09, Student 5): currently admitted patients and their wards
SELECT "Patient"."FullName", "Ward"."WardName"
FROM "Patient"
JOIN "Admission" ON "Patient"."PatientID" = "Admission"."PatientID"
JOIN "Ward" ON "Admission"."WardID" = "Ward"."WardID"
WHERE "Admission"."Status" = 'Active';

-- Q2: active admissions with ward details
SELECT
    a."AdmissionID",
    p."PatientID",
    p."FullName" AS "PatientName",
    w."WardID",
    w."WardName",
    w."FloorNum",
    a."AdmitDate",
    a."Status"
FROM "Admission" a
JOIN "Patient" p ON a."PatientID" = p."PatientID"
JOIN "Ward" w ON a."WardID" = w."WardID"
WHERE a."Status" = 'Active'
ORDER BY w."WardID", a."AdmitDate";

-- Q3: ward occupancy report (the only data public staff can see)
SELECT "WardID", "WardName", "Capacity", "CurrentOccupancy", "AvailableBeds"
FROM "vw_WardCapacity"
ORDER BY "WardID";

-- Q4: full admission history of every patient (shows transfers)
SELECT p."FullName", a."WardID", a."AdmitDate", a."Status"
FROM "Admission" a
JOIN "Patient" p ON a."PatientID" = p."PatientID"
ORDER BY p."PatientID", a."AdmissionID";

-- Q5: open alerts for the nurse workstation
SELECT "AlertID", "Priority", "Status", "NurseID", "UpdatedAt"
FROM "WardAlert"
WHERE "Status" <> 'ACKNOWLEDGED'
ORDER BY CASE "Priority" WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END, "UpdatedAt";

-- -----------------------------------------------------------------------------
-- Procedure usage examples (these change data, so they are commented out)
-- -----------------------------------------------------------------------------
-- CALL sp_AdmitPatient(7, 102);                       -- admit existing patient
-- CALL sp_AdmitPatient(3, 103);                       -- transfer: closes old admission
-- CALL sp_RegisterAndAdmitPatient('Dana Seitkali', '1990-02-14', '+77015550109', 'Female', 104);
-- CALL sp_AcknowledgeAlert('ALT-1001', 'NURSE-03');
