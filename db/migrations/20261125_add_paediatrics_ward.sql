-- Add the permanent paediatric ward without rebuilding or clearing the database.
-- Apply after 20261125_pews_pediatric_ward_types.sql.
\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "Ward"
        WHERE "WardName" = 'Детская палата' AND "WardType" = 'Paediatrics'
    ) THEN
        RETURN;
    END IF;

    IF EXISTS (SELECT 1 FROM "Ward" WHERE "WardID" = 105) THEN
        RAISE EXCEPTION 'WardID 105 is occupied; refusing to replace an existing ward';
    END IF;

    INSERT INTO "Ward" ("WardID", "WardName", "FloorNum", "Capacity", "WardType")
    VALUES (105, 'Детская палата', 1, 8, 'Paediatrics');
END;
$$;

COMMIT;
