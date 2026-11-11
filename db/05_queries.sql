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

-- Q5: open alerts for the nurse workstation (most urgent and oldest first)
SELECT a."AlertID", a."Priority", a."Status", w."WardName", p."FullName" AS "PatientName",
       a."Description", a."AssignedNurseID", a."EscalatedToNurseID", a."CreatedAt"
FROM "WardAlert" a
JOIN "Ward" w ON w."WardID" = a."WardID"
LEFT JOIN "Patient" p ON p."PatientID" = a."PatientID"
WHERE a."Status" <> 'ACKNOWLEDGED'
ORDER BY CASE a."Priority" WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END, a."CreatedAt";

-- Q6: overdue alerts the backend should escalate (HIGH/CRITICAL, PENDING, older than 30 s)
-- and Available nurses who can take them
SELECT a."AlertID", a."Priority", a."AssignedNurseID",
       EXTRACT(EPOCH FROM CURRENT_TIMESTAMP - a."CreatedAt")::INT AS "AgeSeconds"
FROM "WardAlert" a
WHERE a."Status" = 'PENDING'
  AND a."Priority" IN ('HIGH', 'CRITICAL')
  AND a."CreatedAt" <= CURRENT_TIMESTAMP - INTERVAL '30 seconds'
ORDER BY a."CreatedAt";

SELECT "NurseID", "FullName", "Role"
FROM "Nurse"
WHERE "Status" = 'Available'
ORDER BY "NurseID";

-- Q7: response time report for the head nurse (UC-8, view vw_AlertResponse)
SELECT "AlertID", "Priority", "AssignedNurseID", "AcknowledgedByNurseID", "ResponseTime", "WasEscalated"
FROM "vw_AlertResponse"
WHERE "Status" = 'ACKNOWLEDGED'
ORDER BY "CreatedAt";

SELECT "Priority",
       COUNT(*) AS "Alerts",
       COUNT("AcknowledgedAt") AS "Acknowledged",
       COUNT(*) FILTER (WHERE "WasEscalated") AS "Escalated",
       AVG("ResponseTime") AS "AvgResponseTime"
FROM "vw_AlertResponse"
GROUP BY "Priority"
ORDER BY CASE "Priority" WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END;

-- Q8: full journal of one alert (who got it, who it was escalated to, who acknowledged)
SELECT e."OccurredAt", e."EventType", e."NurseID", n."FullName"
FROM "AlertEvent" e
LEFT JOIN "Nurse" n ON n."NurseID" = e."NurseID"
WHERE e."AlertID" = 'ALT-1006'
ORDER BY e."EventID";

-- -----------------------------------------------------------------------------
-- Procedure usage examples (these change data, so they are commented out)
-- -----------------------------------------------------------------------------
-- CALL sp_AdmitPatient(7, 102);                       -- admit existing patient
-- CALL sp_AdmitPatient(3, 103);                       -- transfer: closes old admission
-- CALL sp_RegisterAndAdmitPatient('Dana Seitkali', '1990-02-14', '+77015550109', 'Female', 104);
-- CALL sp_DischargePatient(4);                        -- discharge
-- CALL sp_RaiseAlert(101, 1, 'MONITOR', 'CRITICAL', 'SpO2 83%', 'NURSE-01', NULL);  -- returns ALT-...
-- CALL sp_EscalateAlert('ALT-1001', 'NURSE-03');      -- only overdue HIGH/CRITICAL, to an Available nurse
-- CALL sp_AcknowledgeAlert('ALT-1001', 'NURSE-03');
-- CALL sp_SetNurseStatus('NURSE-02', 'Available');
