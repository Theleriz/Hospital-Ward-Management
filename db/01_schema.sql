-- =============================================================================
-- Hospital Ward Management System (Team MedBase)
-- 01. Schema: tables, constraints, indexes
-- Target: Task 09 & Lab 04 / Task 07
-- =============================================================================

-- Cleanup existing objects if re-running
DROP VIEW IF EXISTS "vw_WardCapacity";
DROP PROCEDURE IF EXISTS sp_RegisterAndAdmitPatient(VARCHAR, DATE, VARCHAR, VARCHAR, INT);
DROP PROCEDURE IF EXISTS sp_AdmitPatient(INT, INT);
DROP PROCEDURE IF EXISTS sp_AcknowledgeAlert(VARCHAR, VARCHAR);
DROP TABLE IF EXISTS "WardAlert" CASCADE;
DROP TABLE IF EXISTS "Admission" CASCADE;
DROP TABLE IF EXISTS "Ward" CASCADE;
DROP TABLE IF EXISTS "Patient" CASCADE;

-- Table: Patient
CREATE TABLE "Patient" (
    "PatientID" SERIAL PRIMARY KEY,
    "FullName" VARCHAR(100) NOT NULL,
    "DOB" DATE NOT NULL,
    "Phone" VARCHAR(20) UNIQUE,
    "Gender" VARCHAR(10)
);

-- Table: Ward
CREATE TABLE "Ward" (
    "WardID" INT PRIMARY KEY,
    "WardName" VARCHAR(50) NOT NULL,
    "FloorNum" INT NOT NULL,
    "Capacity" INT NOT NULL CHECK ("Capacity" > 0),
    "WardType" VARCHAR(50) NOT NULL
);

-- Table: Admission (Bridge Table for Patients <-> Wards)
-- ON DELETE RESTRICT: a patient or ward that still has admission history cannot be deleted
CREATE TABLE "Admission" (
    "AdmissionID" SERIAL PRIMARY KEY,
    "PatientID" INT NOT NULL REFERENCES "Patient"("PatientID") ON DELETE RESTRICT,
    "WardID" INT NOT NULL REFERENCES "Ward"("WardID") ON DELETE RESTRICT,
    "AdmitDate" DATE NOT NULL DEFAULT CURRENT_DATE,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK ("Status" IN ('Active', 'Discharged'))
);

-- A patient can have at most one Active admission (cannot be in two wards at once)
CREATE UNIQUE INDEX "UX_Admission_OneActivePerPatient"
    ON "Admission" ("PatientID")
    WHERE "Status" = 'Active';

CREATE INDEX "IX_Admission_Ward_Status" ON "Admission" ("WardID", "Status");

-- Table: WardAlert (Emergency Alerts / Nurse Workstation Notifications, Lab 04 / Task 07)
CREATE TABLE "WardAlert" (
    "AlertID" VARCHAR(20) PRIMARY KEY,
    "NurseID" VARCHAR(20),
    "Priority" VARCHAR(10) NOT NULL CHECK ("Priority" IN ('LOW', 'HIGH', 'CRITICAL')),
    "Status" VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK ("Status" IN ('PENDING', 'ACKNOWLEDGED', 'ESCALATED')),
    "UpdatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
