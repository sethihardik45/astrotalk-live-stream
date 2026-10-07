import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // Integration tests (tests/integration) need a real database and wipe tables, so they have their own config
  // and are run only through "npm run test:db", which points them at a separate throw-away database.
  test: { include: ["tests/**/*.test.ts"], exclude: ["tests/integration/**", "node_modules/**"], environment: "node" },
});
