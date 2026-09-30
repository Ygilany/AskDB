#!/usr/bin/env node
// Renders the per-package results that `scripts/test-utils/summary-reporter.mjs` wrote
// into `ASKDB_TEST_SUMMARY_DIR` as one Markdown table, for `$GITHUB_STEP_SUMMARY`.
//
//   node scripts/test-summary.mjs "<title>" >> "$GITHUB_STEP_SUMMARY"
//
// Failing packages sort first. Failed test names are listed under the table. Workspace
// packages whose `test` script runs vitest but that recorded nothing (a Turbo cache hit,
// or a run that stopped before their tests finished) get a row too, so none go missing.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const title = process.argv[2] ?? "Tests";
const dir = process.env.ASKDB_TEST_SUMMARY_DIR;

const records =
  dir && existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
    : [];

/** Names of workspace packages whose `test` script runs vitest. */
function vitestPackages() {
  const projects = JSON.parse(execFileSync("pnpm", ["-r", "ls", "--json", "--depth", "-1"], { encoding: "utf8" }));
  return projects
    .filter((p) => p.name && /\bvitest\b/.test(JSON.parse(readFileSync(join(p.path, "package.json"), "utf8")).scripts?.test ?? ""))
    .map((p) => p.name);
}

const recorded = new Set(records.map((r) => r.package));
const missing = records.length > 0 ? vitestPackages().filter((name) => !recorded.has(name)).sort() : [];

const failed = (r) => r.files.failed > 0 || r.tests.failed > 0 || r.unhandledErrors > 0;
const status = (r) => (failed(r) ? "❌" : r.tests.passed === 0 ? "⏭️" : "✅");
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

const lines = [`## ${title}`, ""];
if (records.length === 0) {
  lines.push("No test results were recorded (the run stopped before any package finished its tests).");
} else {
  records.sort((a, b) => Number(failed(b)) - Number(failed(a)) || a.package.localeCompare(b.package));
  const total = { files: 0, passed: 0, failed: 0, skipped: 0 };
  lines.push("| | Package | Files | Passed | Failed | Skipped | Time |", "|---|---|--:|--:|--:|--:|--:|");
  for (const r of records) {
    const files = r.files.passed + r.files.failed + r.files.skipped;
    total.files += files;
    total.passed += r.tests.passed;
    total.failed += r.tests.failed;
    total.skipped += r.tests.skipped;
    const errors = r.unhandledErrors ? ` (+${r.unhandledErrors} unhandled error${r.unhandledErrors === 1 ? "" : "s"})` : "";
    lines.push(
      `| ${status(r)} | \`${r.package}\` | ${files} | ${r.tests.passed} | ${r.tests.failed}${errors} | ${r.tests.skipped} | ${seconds(r.durationMs)} |`,
    );
  }
  for (const name of missing) lines.push(`| ⚪ | \`${name}\` | – | – | – | – | – |`);
  lines.push(`| | **Total (${records.length} packages)** | **${total.files}** | **${total.passed}** | **${total.failed}** | **${total.skipped}** | |`);
  if (missing.length > 0) {
    lines.push("", "⚪ = no result recorded: a Turbo cache hit, or the run stopped before this package's tests finished.");
  }
  if (records.some((r) => status(r) === "⏭️")) {
    lines.push("", "⏭️ = every test in the package skipped (for example, integration suites without a database).");
  }

  const failures = records.flatMap((r) => r.failures.map((f) => ({ ...f, package: r.package })));
  if (failures.length > 0) {
    lines.push("", "### Failed tests", "");
    for (const f of failures) lines.push(`- \`${f.package}\` · \`${f.file}\` · ${f.name}`);
  }
}

process.stdout.write(`${lines.join("\n")}\n`);
