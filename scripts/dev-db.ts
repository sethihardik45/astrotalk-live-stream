/**
 * Starts a real Postgres on your own computer WITHOUT Docker (for local development only).
 * Data lives in the ".devdb" folder. Leave this terminal window open while you work; Ctrl+C stops it.
 *
 * Connection string to put in .env:
 *   DATABASE_URL="postgresql://astro:astro@localhost:5433/astrotalk"
 *
 * In production we use the Postgres container from docker-compose.yml instead.
 */
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";

const DB_DIR = path.resolve(process.cwd(), ".devdb");
const PORT = Number(process.env.DEV_DB_PORT ?? 5433);

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: DB_DIR,
    user: "astro",
    password: "astro",
    port: PORT,
    persistent: true,
  });

  const firstRun = !fs.existsSync(path.join(DB_DIR, "PG_VERSION"));
  if (firstRun) {
    console.log("First run: creating the local database (takes ~10 seconds)...");
    await pg.initialise();
  }
  await pg.start();
  if (firstRun) await pg.createDatabase("astrotalk");

  console.log(`\nLocal Postgres is running.\n  DATABASE_URL="postgresql://astro:astro@localhost:${PORT}/astrotalk"\nPress Ctrl+C to stop.\n`);

  const stop = async () => {
    console.log("\nStopping local Postgres...");
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  // keep the process alive
  setInterval(() => {}, 1 << 30);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
