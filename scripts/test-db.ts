/**
 * Runs the database integration tests against a throw-away database called "astrotalk_test"
 * on the same Postgres you use for development (npm run db:up must be running).
 * Your real data in "astrotalk" is never touched.
 */
import { spawnSync } from "node:child_process";
import pg from "pg";

const base = process.env.DATABASE_URL ?? "postgresql://astro:astro@localhost:5433/astrotalk";
const url = new URL(base);
const testUrl = new URL(base);
testUrl.pathname = "/astrotalk_test";

async function main() {
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query("DROP DATABASE IF EXISTS astrotalk_test WITH (FORCE)");
  await admin.query("CREATE DATABASE astrotalk_test");
  await admin.end();

  const env = { ...process.env, DATABASE_URL: testUrl.toString() };
  const migrate = spawnSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "inherit" });
  if (migrate.status !== 0) process.exit(migrate.status ?? 1);

  const run = spawnSync("npx", ["vitest", "run", "--config", "vitest.db.config.mts", ...process.argv.slice(2)], { env, stdio: "inherit" });
  process.exit(run.status ?? 1);
}

console.log(`Using test database on ${url.host} (astrotalk_test)`);
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
