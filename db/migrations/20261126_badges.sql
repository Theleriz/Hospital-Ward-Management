-- Badge barcode (new-features plan, part 2): badge list for printing and reissue.
-- Run as DB owner on an existing database, then start the new backend.
-- Additive and re-runnable: creates "RetiredBadge" if missing and (re)creates two
-- functions; existing accounts, badges and PINs are not changed.
\set ON_ERROR_STOP on
BEGIN;
\ir ../07_badges.sql
COMMIT;
