import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The fixture's timestamps are naive UTC; every driver must see them unshifted.
    env: { TZ: "UTC" },
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
