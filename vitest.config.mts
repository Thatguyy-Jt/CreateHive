import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path in tsconfig.json.
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // The real package throws outside a Server Components build.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Each DB test file boots its own in-memory Postgres (WASM); allow for startup.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
