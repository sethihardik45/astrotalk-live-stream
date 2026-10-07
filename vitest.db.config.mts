import { defineConfig } from "vitest/config";
import path from "node:path";

// Integration tests: need a real Postgres. Run them with:  npm run test:db
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    setupFiles: ["tests/integration/safety.ts"],
    testTimeout: 20_000,
    env: {
      LIVEKIT_URL: "wss://test.livekit.invalid",
      LIVEKIT_API_KEY: "APItestkey",
      LIVEKIT_API_SECRET: "test-secret-test-secret-test-secret-1234",
      NEXT_PUBLIC_LIVEKIT_URL: "wss://test.livekit.invalid",
      NEXT_PUBLIC_APP_URL: "https://app.example.test",
      OPS_PASSWORD: "test-ops-password",
      SESSION_SECRET: "test-session-secret-test-session-secret-0123456789",
    },
  },
});
