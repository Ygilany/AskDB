// Vitest reporter that records one package's test counts for the CI job summary.
//
// Turbo runs vitest once per package, so no single run can print a table of every
// package. Each run writes `<ASKDB_TEST_SUMMARY_DIR>/<package>.json` instead, and
// `scripts/test-summary.mjs` renders them as one table at the end of the CI job.
// Without `ASKDB_TEST_SUMMARY_DIR` it does nothing.
//
// Plain ESM (not `.ts`), like `integration.mjs`, so it loads without a build step.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Failed test names kept per package; the log and annotations have the rest. */
const MAX_FAILURES = 20;

export default class SummaryReporter {
  /** @param {{ packageName?: string }} [options] */
  constructor(options = {}) {
    this.packageName = options.packageName ?? "unknown";
    this.startedAt = Date.now();
  }

  onTestRunStart() {
    this.startedAt = Date.now();
  }

  /**
   * @param {ReadonlyArray<import("vitest/node").TestModule>} testModules
   * @param {ReadonlyArray<unknown>} unhandledErrors
   */
  onTestRunEnd(testModules, unhandledErrors) {
    const dir = process.env.ASKDB_TEST_SUMMARY_DIR;
    if (!dir) return;

    const files = { passed: 0, failed: 0, skipped: 0 };
    const tests = { passed: 0, failed: 0, skipped: 0 };
    const failures = [];
    for (const module of testModules) {
      const state = module.state();
      if (state === "passed") files.passed++;
      else if (state === "failed") files.failed++;
      else files.skipped++;
      for (const test of module.children.allTests()) {
        const result = test.result().state;
        if (result === "passed") tests.passed++;
        else if (result === "failed") {
          tests.failed++;
          if (failures.length < MAX_FAILURES) failures.push({ file: module.relativeModuleId, name: test.fullName });
        } else tests.skipped++;
      }
    }

    mkdirSync(dir, { recursive: true });
    const record = {
      package: this.packageName,
      files,
      tests,
      failures,
      unhandledErrors: unhandledErrors.length,
      durationMs: Date.now() - this.startedAt,
    };
    writeFileSync(join(dir, `${this.packageName.replace(/[^a-z0-9._-]+/gi, "_")}.json`), `${JSON.stringify(record)}\n`);
  }
}
