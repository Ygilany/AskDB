import { basename } from "node:path";
import { defineConfig } from "vitest/config";

// Tests are scoped to the directory vitest is invoked from (process.cwd()).
// When run from the repo root this picks up all packages; when run from a
// package (e.g. via turbo's per-package `test` script) it picks up only
// that package's tests. The latter is required because each package only
// has @askdb/core symlinked into its own node_modules — running another
// package's tests inside the wrong cwd breaks vite's module resolution.

// In GitHub Actions, vitest adds its `github-actions` reporter, which appends a job
// summary per run. Turbo runs vitest once per package, so name each summary after its
// package; the default title ("Vitest Test Report") is the same for all of them.
// `npm_package_name` is set by `pnpm run test`; the directory name is the fallback.
const packageName = process.env.npm_package_name || basename(process.cwd());

export default defineConfig({
  test: {
    ...(process.env.GITHUB_ACTIONS === "true" && {
      reporters: ["default", ["github-actions", { jobSummary: { title: `Vitest: ${packageName}` } }]],
    }),
    globals: false,
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx", "**/*.integration.test.ts"],
    // The consumer lab is not a workspace member: it has its own install and databases
    // (see examples/consumer-lab/README.md).
    exclude: ["**/node_modules/**", "**/dist/**", "examples/consumer-lab/**"],
    testTimeout: 45_000,
    hookTimeout: 45_000,
  },
});
