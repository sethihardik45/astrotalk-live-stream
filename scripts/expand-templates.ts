/**
 * Expands recurring templates into real shifts for the next 14 days.
 * Safe to run as often as you like (it never duplicates and never overwrites manual edits).
 * The worker also does this automatically once an hour.
 */
import { db } from "../src/lib/db";
import { expandTemplatesToDb } from "../src/lib/shifts";

expandTemplatesToDb(14)
  .then((r) => console.log(`Created ${r.created} shifts (${r.skippedOverlap} skipped because they would overlap).`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
