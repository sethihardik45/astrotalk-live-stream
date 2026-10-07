-- Database-level safeguards for the shared stage.
--
-- 1) A shift must end after it starts.
-- 2) No two shifts may overlap in time (the stage is shared by everyone).
--    '[)' means the start is included and the end is excluded, so back-to-back shifts
--    (one ends at 14:00, the next starts at 14:00) are allowed.
--
-- The exclusion constraint uses a GiST index on a time range. Plain ranges do not need the
-- btree_gist extension, so this works on any stock Postgres.
ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_ends_after_start" CHECK ("endsAt" > "startsAt");

ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_no_overlap"
  EXCLUDE USING gist (tstzrange("startsAt", "endsAt", '[)') WITH &&);
