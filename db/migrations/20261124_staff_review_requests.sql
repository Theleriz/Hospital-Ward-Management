-- Additive migration: preserves existing patients, admissions, alerts and staff.
-- Run once as database owner with the backend stopped:
--   psql "$MEDBASE_TEST_ADMIN_URL" -f db/migrations/20261124_staff_review_requests.sql
\set ON_ERROR_STOP on
BEGIN;

\ir ../00_roles.sql

ALTER TABLE "StaffAccount" DROP CONSTRAINT IF EXISTS "StaffAccount_Role_check";
ALTER TABLE "StaffAccount" ADD CONSTRAINT "StaffAccount_Role_check"
    CHECK ("Role" IN ('Admissions', 'PublicStaff', 'Doctor'));

CREATE TABLE IF NOT EXISTS "StaffReviewRequest" (
    "RequestID" BIGSERIAL PRIMARY KEY,
    "PatientID" INT NOT NULL REFERENCES "Patient"("PatientID") ON DELETE RESTRICT,
    "Reason" TEXT NOT NULL CHECK (length(btrim("Reason")) BETWEEN 1 AND 1000),
    "RequestedBy" VARCHAR(20) NOT NULL,
    "CreatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Status" VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK ("Status" IN ('PENDING', 'REVIEWED')),
    "ReviewedBy" VARCHAR(20) REFERENCES "StaffAccount"("AccountID") ON DELETE RESTRICT,
    "ReviewedAt" TIMESTAMPTZ,
    CONSTRAINT "CK_StaffReviewRequest_ReviewFields" CHECK (
        ("Status" = 'PENDING' AND "ReviewedBy" IS NULL AND "ReviewedAt" IS NULL)
        OR ("Status" = 'REVIEWED' AND "ReviewedBy" IS NOT NULL AND "ReviewedAt" IS NOT NULL)
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS "UX_StaffReviewRequest_OnePendingPerPatient"
    ON "StaffReviewRequest" ("PatientID") WHERE "Status" = 'PENDING';

CREATE TABLE IF NOT EXISTS "DoctorPatientAssignment" (
    "DoctorAccountID" VARCHAR(20) NOT NULL REFERENCES "StaffAccount"("AccountID") ON DELETE CASCADE,
    "PatientID" INT NOT NULL REFERENCES "Patient"("PatientID") ON DELETE CASCADE,
    "AssignedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("DoctorAccountID", "PatientID")
);

-- Doctors receive no table-level patient, request, account or assignment access.
REVOKE ALL ON "StaffReviewRequest", "DoctorPatientAssignment", "Patient", "StaffAccount"
    FROM medbase_doctor;
GRANT SELECT, INSERT ON "StaffReviewRequest" TO medbase_nurse;
GRANT USAGE ON SEQUENCE "StaffReviewRequest_RequestID_seq" TO medbase_nurse;

CREATE OR REPLACE FUNCTION fn_ListAssignedStaffReviewRequests()
RETURNS TABLE (
    "RequestID" BIGINT, "PatientID" INT, "FullName" VARCHAR, "DOB" DATE,
    "Reason" TEXT, "RequestedBy" VARCHAR, "CreatedAt" TIMESTAMPTZ,
    "Status" VARCHAR, "ReviewedBy" VARCHAR, "ReviewedAt" TIMESTAMPTZ
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT r."RequestID", r."PatientID", p."FullName", p."DOB", r."Reason",
           r."RequestedBy", r."CreatedAt", r."Status", r."ReviewedBy", r."ReviewedAt"
    FROM "StaffReviewRequest" r
    JOIN "Patient" p USING ("PatientID")
    WHERE EXISTS (
        SELECT 1 FROM "DoctorPatientAssignment" a
        WHERE a."PatientID" = r."PatientID"
          AND a."DoctorAccountID" = NULLIF(current_setting('medbase.account_id', true), '')
    )
    ORDER BY (r."Status" = 'PENDING') DESC, r."CreatedAt"
$$;

CREATE OR REPLACE FUNCTION fn_MarkAssignedStaffReviewRequestReviewed(p_request_id BIGINT)
RETURNS TABLE (
    "RequestID" BIGINT, "PatientID" INT, "FullName" VARCHAR, "DOB" DATE,
    "Reason" TEXT, "RequestedBy" VARCHAR, "CreatedAt" TIMESTAMPTZ,
    "Status" VARCHAR, "ReviewedBy" VARCHAR, "ReviewedAt" TIMESTAMPTZ
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH updated AS (
        UPDATE "StaffReviewRequest" r
        SET "Status" = 'REVIEWED',
            "ReviewedBy" = NULLIF(current_setting('medbase.account_id', true), ''),
            "ReviewedAt" = CURRENT_TIMESTAMP
        WHERE r."RequestID" = p_request_id
          AND r."Status" = 'PENDING'
          AND EXISTS (
              SELECT 1 FROM "DoctorPatientAssignment" a
              WHERE a."PatientID" = r."PatientID"
                AND a."DoctorAccountID" = NULLIF(current_setting('medbase.account_id', true), '')
          )
        RETURNING r.*
    )
    SELECT u."RequestID", u."PatientID", p."FullName", p."DOB", u."Reason",
           u."RequestedBy", u."CreatedAt", u."Status", u."ReviewedBy", u."ReviewedAt"
    FROM updated u JOIN "Patient" p USING ("PatientID")
$$;

REVOKE ALL ON FUNCTION fn_ListAssignedStaffReviewRequests() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_MarkAssignedStaffReviewRequestReviewed(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_ListAssignedStaffReviewRequests() TO medbase_doctor;
GRANT EXECUTE ON FUNCTION fn_MarkAssignedStaffReviewRequestReviewed(BIGINT) TO medbase_doctor;

COMMIT;
