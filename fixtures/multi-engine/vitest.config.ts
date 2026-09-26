import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Timestamps in the dataset are naive UTC; every driver must see them unshifted.
    env: { TZ: "UTC" },
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
