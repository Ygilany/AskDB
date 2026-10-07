import { defineConfig } from "vitest/config";
import { ciReporters } from "../../scripts/test-utils/ci-reporters.mjs";

export default defineConfig({
  test: {
    // Job summary as one table per CI job; see scripts/test-utils/ci-reporters.mjs.
    ...ciReporters(),
    include: ["test/**/*.test.ts"],
    // Timestamps in the dataset are naive UTC; every driver must see them unshifted.
    env: { TZ: "UTC" },
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
