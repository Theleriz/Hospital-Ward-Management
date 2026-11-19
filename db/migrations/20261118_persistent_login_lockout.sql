-- Stop the old backend, run as DB owner, then start the new backend.
-- Additive and re-runnable: existing patients, alerts, accounts and locks survive.
\set ON_ERROR_STOP on
BEGIN;
\ir ../06_login_security.sql
COMMIT;
