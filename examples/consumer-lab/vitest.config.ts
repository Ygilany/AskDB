import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Verbose, so a skipped scenario's `n/a (capability: …)` note is printed.
    reporters: ["verbose"],
    // The fixture's timestamps are naive UTC; every driver must see them unshifted.
    env: { TZ: "UTC" },
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
