import { defineConfig } from "vitest/config";

// Tests are scoped to the directory vitest is invoked from (process.cwd()).
// When run from the repo root this picks up all packages; when run from a
// package (e.g. via turbo's per-package `test` script) it picks up only
// that package's tests. The latter is required because each package only
// has @askdb/core symlinked into its own node_modules — running another
// package's tests inside the wrong cwd breaks vite's module resolution.
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx", "**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 45_000,
    hookTimeout: 45_000,
  },
});
