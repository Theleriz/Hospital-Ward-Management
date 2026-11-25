-- Corridor board (part 4): role medbase_board and view vw_CorridorAlerts.
-- Run as DB owner on an existing database, then start the new backend.
-- Additive and re-runnable: 03_security.sql only creates or replaces views,
-- creates missing roles and (re)grants rights; no data changes.
\set ON_ERROR_STOP on
BEGIN;
\ir ../03_security.sql
COMMIT;
