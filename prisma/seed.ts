/**
 * Seed script: 12 sample astrologers, each with two daily one-hour slots, so the 24 hours of every day
 * are covered (astrologer #1 = 00:00 and 12:00, #2 = 01:00 and 13:00, ... #12 = 11:00 and 23:00 IST).
 * Then expands the templates into real shifts for the next 14 days.
 *
 * Safe to run more than once: it never creates duplicates.
 * It prints each astrologer's personal link at the end.
 */
import { db } from "../src/lib/db";
import { generateSlug } from "../src/lib/slug";
import { expandTemplatesToDb } from "../src/lib/shifts";

const SAMPLE = [
  ["Pandit Ravi Shankar", "Vedic Astrologer"],
  ["Meera Joshi", "Tarot & Numerology"],
  ["Acharya Arun Mishra", "KP Astrology"],
  ["Dr. Kavita Rao", "Vastu Expert"],
  ["Swami Anand", "Palmistry Specialist"],
  ["Neha Kapoor", "Relationship Astrologer"],
  ["Guru Vikram Sharma", "Career & Finance"],
  ["Sunita Devi", "Lal Kitab Expert"],
  ["Pt. Rajesh Tiwari", "Vedic & Remedies"],
  ["Anjali Menon", "Nadi Astrology"],
  ["Rohit Bhardwaj", "Numerology Expert"],
  ["Priya Nair", "Tarot Reader"],
] as const;

async function main() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  for (let i = 0; i < SAMPLE.length; i++) {
    const [name, tagline] = SAMPLE[i];
    let astro = await db.astrologer.findFirst({ where: { name } });
    if (!astro) astro = await db.astrologer.create({ data: { name, tagline, slug: generateSlug() } });

    for (const hour of [i, i + 12]) {
      const startTimeLocal = `${String(hour).padStart(2, "0")}:00`;
      const exists = await db.shiftTemplate.findFirst({ where: { astrologerId: astro.id, startTimeLocal } });
      if (!exists) {
        await db.shiftTemplate.create({
          data: { astrologerId: astro.id, startTimeLocal, durationMinutes: 60, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] },
        });
      }
    }
  }

  const { created, skippedOverlap } = await expandTemplatesToDb(14);
  console.log(`\nShifts created: ${created} (skipped because of overlaps: ${skippedOverlap})\n`);

  const all = await db.astrologer.findMany({ orderBy: { createdAt: "asc" } });
  console.log("Astrologer links (keep these secret):");
  for (const a of all) console.log(`  ${a.name.padEnd(24)} ${appUrl}/live/${a.slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
