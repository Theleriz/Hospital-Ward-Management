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
-- =============================================================================

-- Clear existing data and reset sequence counters
TRUNCATE TABLE "WardAlert", "Admission", "Ward", "Patient" RESTART IDENTITY CASCADE;

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
INSERT INTO "Admission" ("PatientID", "WardID", "AdmitDate", "Status") VALUES
-- Active Admissions in Ward 101 (Occupancy 2/2 - Full)
(1, 101, CURRENT_DATE - 2, 'Active'),
(2, 101, CURRENT_DATE - 1, 'Active'),

-- Active Admissions in Ward 102 (Occupancy 2/4)
(3, 102, CURRENT_DATE - 5, 'Active'),
(4, 102, CURRENT_DATE, 'Active'),

-- Historical Discharged Admissions
(5, 103, CURRENT_DATE - 10, 'Discharged'),
(6, 102, CURRENT_DATE - 12, 'Discharged');

-- -----------------------------------------------------------------------------
-- 4. SEED WARD ALERTS (Nurse Workstation Escalation Logs)
-- -----------------------------------------------------------------------------
INSERT INTO "WardAlert" ("AlertID", "NurseID", "Priority", "Status", "UpdatedAt") VALUES
('ALT-1001', NULL, 'CRITICAL', 'PENDING', CURRENT_TIMESTAMP - INTERVAL '5 minutes'),
('ALT-1002', 'NURSE-01', 'HIGH', 'ACKNOWLEDGED', CURRENT_TIMESTAMP - INTERVAL '15 minutes'),
('ALT-1003', NULL, 'CRITICAL', 'ESCALATED', CURRENT_TIMESTAMP - INTERVAL '30 minutes'),
('ALT-1004', 'NURSE-02', 'LOW', 'ACKNOWLEDGED', CURRENT_TIMESTAMP - INTERVAL '1 hour');
