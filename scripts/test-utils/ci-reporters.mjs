// Vitest reporters for GitHub Actions, shared by the root `vitest.config.ts` and the
// multi-engine fixture's config.
//
// In GitHub Actions, vitest adds its `github-actions` reporter, whose job summary is one
// untitled "Vitest Test Report" per run. Turbo runs vitest once per package, so a CI job
// got ~20 of them. This keeps that reporter's annotations but turns its summary off;
// `summary-reporter.mjs` records each package's counts instead, and
// `scripts/test-summary.mjs` renders them as one table at the end of the job (see the
// unit and test jobs in ci.yml). Outside GitHub Actions it returns `{}`, so vitest's
// defaults apply.
//
// Plain ESM + a sibling `.d.mts`, like `integration.mjs`.
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const summaryReporter = fileURLToPath(new URL("./summary-reporter.mjs", import.meta.url));

export function ciReporters() {
  if (process.env.GITHUB_ACTIONS !== "true") return {};
  // `npm_package_name` is set by `pnpm run test`; the directory name is the fallback.
  const packageName = process.env.npm_package_name || basename(process.cwd());
  return {
    reporters: ["default", ["github-actions", { jobSummary: { enabled: false } }], [summaryReporter, { packageName }]],
  };
}
