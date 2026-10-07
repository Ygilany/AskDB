import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Live-model mode calls a real model and needs a key: only `LAB_LIVE_MODEL=1` runs it (#247).
    exclude: process.env.LAB_LIVE_MODEL === "1" ? configDefaults.exclude : [...configDefaults.exclude, "test/live.test.ts"],
    // Verbose, so a skipped scenario's `n/a (capability: …)` note is printed.
    reporters: ["verbose"],
    // The fixture's timestamps are naive UTC; every driver must see them unshifted.
    env: { TZ: "UTC" },
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
