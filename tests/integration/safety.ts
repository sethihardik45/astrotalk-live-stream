/**
 * SAFETY NET: integration tests delete everything in the tables they use.
 * Refuse to run unless the database is the throw-away test database. (This runs before any test code is loaded.)
 */
const url = process.env.DATABASE_URL ?? "";
if (!/\/astrotalk_test(\?|$)/.test(url)) {
  throw new Error("Refusing to run: DATABASE_URL must point at the 'astrotalk_test' database. Use: npm run test:db");
}
