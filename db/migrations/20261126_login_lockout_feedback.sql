-- Report a newly established lockout on the attempt that starts it.
-- Replaces the functions in place and preserves existing data and locks.
\set ON_ERROR_STOP on
BEGIN;
\ir ../06_login_security.sql
\ir ../07_badges.sql
COMMIT;
