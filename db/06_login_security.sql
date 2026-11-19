-- T-48: shared, restart-safe login state. Also applied by the additive migration.
-- No PIN, hash, cookie or patient data is stored in this table.
CREATE TABLE IF NOT EXISTS "LoginThrottle" (
    "BadgeID" VARCHAR(32) PRIMARY KEY,
    "Failures" INTEGER NOT NULL DEFAULT 0 CHECK ("Failures" >= 0),
    "LockedUntil" TIMESTAMPTZ,
    "UpdatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION fn_LoginStaff(
    p_BadgeID VARCHAR, p_Pin VARCHAR,
    p_MaxFailures INTEGER DEFAULT 5, p_LockoutSeconds INTEGER DEFAULT 300
)
RETURNS TABLE (
    "Outcome" TEXT, "RetryAfter" INTEGER,
    "AccountID" VARCHAR, "FullName" VARCHAR, "Role" VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_badge VARCHAR := btrim(p_BadgeID);
    v_failures INTEGER;
    v_locked TIMESTAMPTZ;
    v_now TIMESTAMPTZ;
    v_user RECORD;
BEGIN
    IF v_badge IS NULL OR length(v_badge) NOT BETWEEN 1 AND 32
       OR p_Pin IS NULL OR p_Pin !~ '^[0-9]{4,8}$'
       OR p_MaxFailures IS NULL OR p_MaxFailures NOT BETWEEN 1 AND 1000
       OR p_LockoutSeconds IS NULL OR p_LockoutSeconds NOT BETWEEN 1 AND 86400 THEN
        RAISE EXCEPTION 'Invalid login parameters' USING ERRCODE = '22023';
    END IF;

    INSERT INTO "LoginThrottle" ("BadgeID") VALUES (v_badge) ON CONFLICT DO NOTHING;
    -- One badge is serialized across connections, backend processes and restarts.
    SELECT "Failures", "LockedUntil" INTO v_failures, v_locked
      FROM "LoginThrottle" WHERE "BadgeID" = v_badge FOR UPDATE;
    -- Read the DB wall clock AFTER waiting for the row lock.
    v_now := clock_timestamp();
    IF v_locked > v_now THEN
        RETURN QUERY SELECT 'LOCKED'::TEXT,
            GREATEST(1, CEIL(EXTRACT(EPOCH FROM v_locked - v_now))::INTEGER),
            NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR;
        RETURN;
    END IF;
    IF v_locked IS NOT NULL THEN
        v_failures := 0;
    END IF;

    -- Private bcrypt verifier. Its execute privilege is not granted to medbase_api.
    SELECT * INTO v_user FROM fn_AuthenticateStaff(v_badge, p_Pin);
    IF FOUND THEN
        UPDATE "LoginThrottle" SET "Failures" = 0, "LockedUntil" = NULL,
            "UpdatedAt" = v_now WHERE "BadgeID" = v_badge;
        RETURN QUERY SELECT 'OK'::TEXT, 0,
            v_user."AccountID", v_user."FullName", v_user."Role";
    ELSE
        v_failures := v_failures + 1;
        UPDATE "LoginThrottle" SET
            "Failures" = CASE WHEN v_failures >= p_MaxFailures THEN 0 ELSE v_failures END,
            "LockedUntil" = CASE WHEN v_failures >= p_MaxFailures
                THEN v_now + make_interval(secs => p_LockoutSeconds) ELSE NULL END,
            "UpdatedAt" = v_now WHERE "BadgeID" = v_badge;
        -- The fifth failed attempt remains 401; following attempts are 429.
        RETURN QUERY SELECT 'INVALID'::TEXT, 0, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR;
    END IF;
END;
$$;

REVOKE ALL ON "LoginThrottle" FROM PUBLIC, medbase_api, medbase_admissions,
    medbase_public_staff, medbase_nurse, medbase_head_nurse, medbase_alert_service;
REVOKE EXECUTE ON FUNCTION fn_AuthenticateStaff(VARCHAR, VARCHAR) FROM PUBLIC, medbase_api;
REVOKE EXECUTE ON FUNCTION fn_LoginStaff(VARCHAR, VARCHAR, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_LoginStaff(VARCHAR, VARCHAR, INTEGER, INTEGER) TO medbase_api;
