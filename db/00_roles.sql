-- =============================================================================
-- Hospital Ward Management System (Team MedBase)
-- Cluster-wide roles and role memberships.
-- Roles live outside any database, so pg_dump does not save them. This file is
-- run by 03_security.sql and by scripts/restore-db.sh before a dump is loaded
-- (a fresh server has no roles, and the dump's GRANTs would fail without them).
-- Re-runnable: creates a role only if it is missing.
-- =============================================================================

-- Roles are cluster-wide, so create them only if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medbase_admissions') THEN
        CREATE ROLE medbase_admissions NOLOGIN;  -- doctors & admissions staff
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medbase_public_staff') THEN
        CREATE ROLE medbase_public_staff NOLOGIN;  -- other hospital staff
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medbase_nurse') THEN
        CREATE ROLE medbase_nurse NOLOGIN;  -- ward nurses
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medbase_head_nurse') THEN
        CREATE ROLE medbase_head_nurse NOLOGIN;  -- head nurse: a nurse plus the report (UC-8)
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medbase_alert_service') THEN
        CREATE ROLE medbase_alert_service NOLOGIN;  -- escalation worker, device simulator
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medbase_board') THEN
        CREATE ROLE medbase_board NOLOGIN;  -- corridor board: ward summary only, no patient data
    END IF;
    -- The backend logs in as medbase_api. NOINHERIT: on its own it has no access to
    -- the data; for every request it switches (SET ROLE) to the role of the signed-in
    -- user, so the database checks rights again (decisions.md, record 5).
    -- The password is for local development only.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medbase_api') THEN
        CREATE ROLE medbase_api LOGIN NOINHERIT PASSWORD 'medbase_api';
    END IF;
END;
$$;

GRANT medbase_admissions, medbase_public_staff, medbase_nurse, medbase_head_nurse, medbase_alert_service,
      medbase_board
    TO medbase_api;

-- The head nurse can do everything a nurse can (inherits medbase_nurse)
GRANT medbase_nurse TO medbase_head_nurse;
