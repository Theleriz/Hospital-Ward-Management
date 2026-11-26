-- =============================================================================
-- Badges with a barcode (new-features plan, part 2)
--   * the head nurse prints badges: name, role and a Code 128 barcode that holds
--     only the badge number (never the PIN);
--   * reissuing a badge gives the person a new number; the old one stops working
--     at once and is never handed out again ("RetiredBadge").
-- A barcode is easy to copy with a photo, so the PIN stays the second factor and
-- the lockout after 5 wrong PINs (06_login_security.sql) still applies.
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

REVOKE ALL ON "RetiredBadge" FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_ListStaffBadges() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_ReissueBadge(VARCHAR, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_ListStaffBadges() TO medbase_head_nurse;
GRANT EXECUTE ON FUNCTION fn_ReissueBadge(VARCHAR, VARCHAR) TO medbase_head_nurse;
