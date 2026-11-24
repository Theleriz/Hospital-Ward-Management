-- Additive PEWS context support. This does not recreate or clear any table.
-- Run against a database with the MedBase schema as its owner.
\set ON_ERROR_STOP on
BEGIN;

ALTER TABLE "Ward" DROP CONSTRAINT IF EXISTS "CK_Ward_ValidType";
ALTER TABLE "Ward" ADD CONSTRAINT "CK_Ward_ValidType"
    CHECK ("WardType" IN (
        'Intensive Care', 'General Medicine', 'Surgery', 'Emergency',
        'Paediatrics', 'Neonatal', 'Maternity', 'Obstetrics'
    ));

-- The simulator needs DOB and ward context only for an active admission. Keep
-- that lookup behind one narrow function instead of granting table access.
REVOKE SELECT ("DOB") ON "Patient" FROM medbase_alert_service;

CREATE OR REPLACE FUNCTION fn_GetActivePewsContext(p_patient_id INT)
RETURNS TABLE ("DOB" DATE, "WardType" VARCHAR, "EvaluationDate" DATE)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT p."DOB", w."WardType", CURRENT_DATE
    FROM "Admission" a
    JOIN "Patient" p ON p."PatientID" = a."PatientID"
    JOIN "Ward" w ON w."WardID" = a."WardID"
    WHERE a."PatientID" = p_patient_id AND a."Status" = 'Active'
$$;

REVOKE ALL ON FUNCTION fn_GetActivePewsContext(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_GetActivePewsContext(INT) TO medbase_alert_service;

COMMIT;
