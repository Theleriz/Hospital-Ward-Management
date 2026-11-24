-- =============================================================================
-- Hospital Ward Management System (Team MedBase)
-- Full database setup: schema -> procedures -> security -> seed data
-- Run:  psql -f setup.sql   (re-runnable: drops and recreates everything)
-- =============================================================================

\set ON_ERROR_STOP on

\echo '>> 01_schema.sql'
\ir 01_schema.sql
\echo '>> 02_procedures.sql'
\ir 02_procedures.sql
\echo '>> 03_security.sql'
\ir 03_security.sql

\echo '>> 06_login_security.sql'
\ir 06_login_security.sql
\echo '>> 20261124_staff_review_requests.sql'
\ir migrations/20261124_staff_review_requests.sql
\echo '>> 04_seed.sql'
\ir 04_seed.sql

\echo '>> Database ready'
