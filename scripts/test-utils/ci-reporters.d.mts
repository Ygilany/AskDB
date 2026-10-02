import type { InlineConfig } from "vitest/node";

/**
 * In GitHub Actions: vitest's default reporter, its `github-actions` reporter with the job
 * summary off, and `summary-reporter.mjs`. Elsewhere: `{}` (vitest's defaults).
 */
export declare function ciReporters(): Pick<InlineConfig, "reporters">;
