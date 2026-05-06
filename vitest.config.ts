import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: repoRoot,
  test: {
    globals: false,
    environment: "node",
    include: ["packages/**/*.test.ts", "packages/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 45_000,
    hookTimeout: 45_000,
  },
});
