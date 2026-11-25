import { defineConfig } from "vitest/config";

// The CLI and HTTP API replays (and Studio's API). Studio's UI replays run under Playwright
// (playwright.config.ts). Each test file makes its own run, with its own ports and project.
export default defineConfig({
  test: {
    include: ["cli/**/*.test.ts", "api/**/*.test.ts", "studio/**/*.test.ts", "harness/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
});
