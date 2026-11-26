-- =============================================================================
-- Badges with a barcode (new-features plan, part 2)
--   * the head nurse prints badges: name, role and a Code 128 barcode that holds
--     only the badge number (never the PIN);
--   * reissuing a badge gives the person a new number; the old one stops working
--     at once and is never handed out again ("RetiredBadge").
-- A barcode is easy to copy with a photo, so the PIN stays the second factor and
-- the lockout after 5 wrong PINs (06_login_security.sql) still applies.
-- Demo only: with MEDBASE_DEMO_BADGE_LOGIN=true the badge alone logs in
-- (fn_LoginStaffByBadge); off by default.
-- Self-contained and re-runnable: used by setup.sql and db/migrations/20261126_badges.sql.
-- =============================================================================

-- Numbers taken away by a reissue: who had it, when, and who reissued it
CREATE TABLE IF NOT EXISTS "RetiredBadge" (
    "BadgeID" VARCHAR(32) PRIMARY KEY,
    "PersonID" VARCHAR(20) NOT NULL,
    "RetiredAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "RetiredBy" VARCHAR(20) NOT NULL
);

--------------------------------------------------------------------------------
-- fn_ListStaffBadges: everyone who can log in, with the badge number to print.
-- SECURITY DEFINER: the head nurse has no access to "StaffAccount" or to the
-- "BadgeID" column; PIN hashes are never returned.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_ListStaffBadges()
RETURNS TABLE ("PersonID" VARCHAR, "FullName" VARCHAR, "Role" VARCHAR, "BadgeID" VARCHAR)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT n."NurseID", n."FullName", n."Role", n."BadgeID" FROM "Nurse" n
    UNION ALL
    SELECT s."AccountID", s."FullName", s."Role", s."BadgeID" FROM "StaffAccount" s WHERE s."IsActive"
    ORDER BY 2, 1;
$$;

--------------------------------------------------------------------------------
-- fn_ReissueBadge: a new badge number for the person; returns it.
-- The old number goes to "RetiredBadge", so it can no longer log in and is
-- never given to anyone else. Raises P0002 when there is no such active person.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_ReissueBadge(p_PersonID VARCHAR, p_ReissuedBy VARCHAR)
RETURNS VARCHAR
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_old VARCHAR(32);
    v_new VARCHAR(32);
BEGIN
    SELECT "BadgeID" INTO v_old FROM "Nurse" WHERE "NurseID" = p_PersonID FOR UPDATE;
    IF v_old IS NULL THEN
        SELECT "BadgeID" INTO v_old FROM "StaffAccount"
        WHERE "AccountID" = p_PersonID AND "IsActive" FOR UPDATE;
    END IF;
    IF v_old IS NULL THEN
        RAISE EXCEPTION 'Staff member % not found.', p_PersonID USING ERRCODE = 'P0002';
    END IF;

    -- A random number nobody has now or had before
    LOOP
        v_new := 'BADGE-' || lpad((floor(random() * 1000000))::INT::TEXT, 6, '0');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM "Nurse" WHERE "BadgeID" = v_new)
              AND NOT EXISTS (SELECT 1 FROM "StaffAccount" WHERE "BadgeID" = v_new)
              AND NOT EXISTS (SELECT 1 FROM "RetiredBadge" WHERE "BadgeID" = v_new);
    END LOOP;

    INSERT INTO "RetiredBadge" ("BadgeID", "PersonID", "RetiredBy")
    VALUES (v_old, p_PersonID, p_ReissuedBy)
    ON CONFLICT ("BadgeID") DO NOTHING;

    UPDATE "Nurse" SET "BadgeID" = v_new WHERE "NurseID" = p_PersonID;
    UPDATE "StaffAccount" SET "BadgeID" = v_new WHERE "AccountID" = p_PersonID;
    RETURN v_new;
END;
$$;

--------------------------------------------------------------------------------
-- fn_LoginStaffByBadge: DEMO ONLY, login with the badge alone (no PIN).
-- The backend calls it only when MEDBASE_DEMO_BADGE_LOGIN=true (decisions.md,
-- record 16). Same lockout as fn_LoginStaff: an unknown badge counts as a failed
-- attempt, so guessing numbers still locks after p_MaxFailures tries.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_LoginStaffByBadge(
    p_BadgeID VARCHAR, p_MaxFailures INTEGER DEFAULT 5, p_LockoutSeconds INTEGER DEFAULT 300
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
    v_id VARCHAR;
    v_name VARCHAR;
    v_role VARCHAR;
BEGIN
    IF v_badge IS NULL OR length(v_badge) NOT BETWEEN 1 AND 32
       OR p_MaxFailures IS NULL OR p_MaxFailures NOT BETWEEN 1 AND 1000
       OR p_LockoutSeconds IS NULL OR p_LockoutSeconds NOT BETWEEN 1 AND 86400 THEN
        RAISE EXCEPTION 'Invalid login parameters' USING ERRCODE = '22023';
    END IF;

    INSERT INTO "LoginThrottle" ("BadgeID") VALUES (v_badge) ON CONFLICT DO NOTHING;
    SELECT "Failures", "LockedUntil" INTO v_failures, v_locked
      FROM "LoginThrottle" WHERE "BadgeID" = v_badge FOR UPDATE;
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

    SELECT n."NurseID", n."FullName", n."Role" INTO v_id, v_name, v_role
      FROM "Nurse" n WHERE n."BadgeID" = v_badge;
    IF v_id IS NULL THEN
        SELECT s."AccountID", s."FullName", s."Role" INTO v_id, v_name, v_role
          FROM "StaffAccount" s WHERE s."BadgeID" = v_badge AND s."IsActive";
    END IF;

    IF v_id IS NOT NULL THEN
        UPDATE "LoginThrottle" SET "Failures" = 0, "LockedUntil" = NULL,
            "UpdatedAt" = v_now WHERE "BadgeID" = v_badge;
        RETURN QUERY SELECT 'OK'::TEXT, 0, v_id, v_name, v_role;
    ELSE
        v_failures := v_failures + 1;
        UPDATE "LoginThrottle" SET
            "Failures" = CASE WHEN v_failures >= p_MaxFailures THEN 0 ELSE v_failures END,
            "LockedUntil" = CASE WHEN v_failures >= p_MaxFailures
                THEN v_now + make_interval(secs => p_LockoutSeconds) ELSE NULL END,
            "UpdatedAt" = v_now WHERE "BadgeID" = v_badge;
        RETURN QUERY SELECT 'INVALID'::TEXT, 0, NULL::VARCHAR, NULL::VARCHAR, NULL::VARCHAR;
    END IF;
END;
$$;

REVOKE ALL ON "RetiredBadge" FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_ListStaffBadges() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_ReissueBadge(VARCHAR, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_ListStaffBadges() TO medbase_head_nurse;
GRANT EXECUTE ON FUNCTION fn_ReissueBadge(VARCHAR, VARCHAR) TO medbase_head_nurse;
REVOKE EXECUTE ON FUNCTION fn_LoginStaffByBadge(VARCHAR, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_LoginStaffByBadge(VARCHAR, INTEGER, INTEGER) TO medbase_api;
