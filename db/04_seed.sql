-- =============================================================================
-- Hospital Ward Management System (Team MedBase)
-- 04. Seed data: realistic test data for development & testing
-- Requires: 01_schema.sql (re-runnable: clears all tables first)
--
-- Resulting state (used by tests/test_hospital_ward.sql):
--   Ward 101 ICU        2/2  FULL  (patients 1, 2)
--   Ward 102 General    2/4        (patients 3, 4; patient 6 discharged)
--   Ward 103 Surgery    0/3        (patient 5 discharged)
--   Ward 104 Emergency  0/5
--   Patients 5-8 have no active admission
--
-- Nurses (test PINs, for development only):
--   NURSE-01  badge BADGE-1001  PIN 1111  Available  ward 101 (primary)
--   NURSE-02  badge BADGE-1002  PIN 2222  Busy       ward 102 (primary), ward 101
--   NURSE-03  badge BADGE-1003  PIN 3333  Available  ward 103 (primary), ward 102
--   NURSE-04  badge BADGE-1004  PIN 4444  Available  ward 104 (primary)
--   NURSE-05  badge BADGE-1005  PIN 5555  OffShift   ward 104
--   NURSE-10  badge BADGE-1010  PIN 1010  Available  head nurse, no ward
--
-- Alerts:
--   ALT-1001  CRITICAL  PENDING       ward 101  5 min old -> overdue, can be escalated
--   ALT-1002  HIGH      ACKNOWLEDGED  ward 102  acknowledged by NURSE-02 after 12 s
--   ALT-1003  CRITICAL  ESCALATED     ward 101  NURSE-01 -> NURSE-03, not acknowledged
--   ALT-1004  LOW       ACKNOWLEDGED  ward 102  acknowledged by NURSE-03 after 45 s
--   ALT-1005  HIGH      PENDING       ward 102  10 s old right after seeding -> not overdue yet
--   ALT-1006  HIGH      ACKNOWLEDGED  ward 101  escalated to NURSE-04, acknowledged by her
-- The AlertEvent journal is filled by the trigger on WardAlert (17 events).
-- =============================================================================

-- Clear existing data and reset sequence counters
TRUNCATE TABLE "AlertEvent", "WardAlert", "NurseAssignment", "Nurse", "Admission", "Ward", "Patient"
    RESTART IDENTITY CASCADE;

-- -----------------------------------------------------------------------------
-- 1. SEED PATIENTS
-- -----------------------------------------------------------------------------
INSERT INTO "Patient" ("FullName", "DOB", "Phone", "Gender") VALUES
('Akezhan Ivanov', '1985-04-12', '+77015550101', 'Male'),
('Elena Smirnova', '1992-08-25', '+77015550102', 'Female'),
('Kuanyshbek Bauyrzhanuly', '1998-12-01', '+77015550103', 'Male'),
('Rishat Zhanat', '2001-03-15', '+77015550104', 'Male'),
('Nurali Zhanserikuly', '1995-07-20', '+77015550105', 'Male'),
('Baigel Chinaliyev', '1997-11-30', '+77015550106', 'Male'),
('Kazbek Shynbulat', '2000-01-10', '+77015550107', 'Male'),
('Anna Petrova', '1988-06-18', '+77015550108', 'Female');

-- -----------------------------------------------------------------------------
-- 2. SEED WARDS
-- -----------------------------------------------------------------------------
INSERT INTO "Ward" ("WardID", "WardName", "FloorNum", "Capacity", "WardType") VALUES
(101, 'ICU Unit A', 1, 2, 'Intensive Care'),
(102, 'General Medical Ward 1', 2, 4, 'General Medicine'),
(103, 'Surgical Recovery Ward', 2, 3, 'Surgery'),
(104, 'Emergency Overflow Ward', 1, 5, 'Emergency');

-- -----------------------------------------------------------------------------
-- 3. SEED ADMISSIONS (Historical & Current Active Admissions)
-- -----------------------------------------------------------------------------
INSERT INTO "Admission" ("PatientID", "WardID", "AdmitDate", "DischargeDate", "Status") VALUES
-- Active Admissions in Ward 101 (Occupancy 2/2 - Full)
(1, 101, CURRENT_DATE - 2, NULL, 'Active'),
(2, 101, CURRENT_DATE - 1, NULL, 'Active'),

-- Active Admissions in Ward 102 (Occupancy 2/4)
(3, 102, CURRENT_DATE - 5, NULL, 'Active'),
(4, 102, CURRENT_DATE, NULL, 'Active'),

-- Historical Discharged Admissions
(5, 103, CURRENT_DATE - 10, CURRENT_DATE - 7, 'Discharged'),
(6, 102, CURRENT_DATE - 12, CURRENT_DATE - 9, 'Discharged');

-- -----------------------------------------------------------------------------
-- 4. SEED NURSES (PINs are stored as bcrypt hashes)
-- -----------------------------------------------------------------------------
INSERT INTO "Nurse" ("NurseID", "FullName", "BadgeID", "PinHash", "Role", "Status") VALUES
('NURSE-01', 'Aigerim Sadykova', 'BADGE-1001', crypt('1111', gen_salt('bf')), 'Nurse', 'Available'),
('NURSE-02', 'Dinara Omarova', 'BADGE-1002', crypt('2222', gen_salt('bf')), 'Nurse', 'Busy'),
('NURSE-03', 'Madina Tulegenova', 'BADGE-1003', crypt('3333', gen_salt('bf')), 'Nurse', 'Available'),
('NURSE-04', 'Aliya Nurlanova', 'BADGE-1004', crypt('4444', gen_salt('bf')), 'Nurse', 'Available'),
('NURSE-05', 'Saule Bekova', 'BADGE-1005', crypt('5555', gen_salt('bf')), 'Nurse', 'OffShift'),
('NURSE-10', 'Gulnara Akhmetova', 'BADGE-1010', crypt('1010', gen_salt('bf')), 'HeadNurse', 'Available');

-- -----------------------------------------------------------------------------
-- 5. SEED NURSE ASSIGNMENTS (one primary nurse per ward)
-- -----------------------------------------------------------------------------
INSERT INTO "NurseAssignment" ("NurseID", "WardID", "IsPrimary") VALUES
('NURSE-01', 101, TRUE),
('NURSE-02', 101, FALSE),
('NURSE-02', 102, TRUE),
('NURSE-03', 102, FALSE),
('NURSE-03', 103, TRUE),
('NURSE-04', 104, TRUE),
('NURSE-05', 104, FALSE);

-- -----------------------------------------------------------------------------
-- 6. SEED WARD ALERTS (Nurse Workstation Escalation Logs)
-- -----------------------------------------------------------------------------
INSERT INTO "WardAlert" (
    "AlertID", "WardID", "PatientID", "Source", "Priority", "Description", "Status",
    "AssignedNurseID", "EscalatedToNurseID", "AcknowledgedByNurseID",
    "CreatedAt", "EscalatedAt", "AcknowledgedAt", "UpdatedAt"
)
SELECT a."AlertID", a."WardID", a."PatientID", a."Source", a."Priority", a."Description", a."Status",
       a."Assigned", a."EscalatedTo", a."AcknowledgedBy",
       t.now - a."CreatedAgo",
       t.now - a."CreatedAgo" + a."EscalatedAfter",
       t.now - a."CreatedAgo" + a."AcknowledgedAfter",
       t.now - a."CreatedAgo" + GREATEST(INTERVAL '0', a."EscalatedAfter", a."AcknowledgedAfter")
FROM (SELECT CURRENT_TIMESTAMP AS now) t,
(VALUES
    ('ALT-1001', 101, 1, 'MONITOR', 'CRITICAL', 'SpO2 dropped to 84%', 'PENDING',
     'NURSE-01', NULL, NULL, INTERVAL '5 minutes', NULL::INTERVAL, NULL::INTERVAL),
    ('ALT-1002', 102, 3, 'CALL_BUTTON', 'HIGH', 'Patient pressed the call button', 'ACKNOWLEDGED',
     'NURSE-02', NULL, 'NURSE-02', INTERVAL '15 minutes', NULL, INTERVAL '12 seconds'),
    ('ALT-1003', 101, 2, 'MONITOR', 'CRITICAL', 'Heart rate 142 bpm', 'ESCALATED',
     'NURSE-01', 'NURSE-03', NULL, INTERVAL '30 minutes', INTERVAL '30 seconds', NULL),
    ('ALT-1004', 102, 4, 'CALL_BUTTON', 'LOW', 'Patient asks for water', 'ACKNOWLEDGED',
     'NURSE-03', NULL, 'NURSE-03', INTERVAL '1 hour', NULL, INTERVAL '45 seconds'),
    ('ALT-1005', 102, 4, 'MONITOR', 'HIGH', 'Blood pressure 175/110', 'PENDING',
     'NURSE-02', NULL, NULL, INTERVAL '10 seconds', NULL, NULL),
    ('ALT-1006', 101, 1, 'MONITOR', 'HIGH', 'Respiratory rate 28/min', 'ACKNOWLEDGED',
     'NURSE-01', 'NURSE-04', 'NURSE-04', INTERVAL '2 hours', INTERVAL '30 seconds', INTERVAL '50 seconds')
) AS a("AlertID", "WardID", "PatientID", "Source", "Priority", "Description", "Status",
       "Assigned", "EscalatedTo", "AcknowledgedBy", "CreatedAgo", "EscalatedAfter", "AcknowledgedAfter");

-- Next raised alert gets ALT-1007
DO $$ BEGIN PERFORM setval('"WardAlert_AlertNo_seq"', 1006); END $$;
