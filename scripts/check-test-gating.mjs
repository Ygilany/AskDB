#!/usr/bin/env node
// Fails when a test file gates a suite or test by hand instead of through
// `integrationSuite()` (scripts/test-utils/integration.mjs).
//
// Hand-rolled gates (`describe.skip`, `describe.skipIf(...)`, `cond ? describe : describe.skip`)
// skip silently when a prerequisite is missing, so CI's ASKDB_REQUIRE_INTEGRATION=1 can't turn
// a missing database or driver into a failure. `integrationSuite()` is the one sanctioned gate.
//
// Scans *.test.ts / *.test.tsx under packages/*/src and apps/*/src; scripts/test-utils/, which
// implements integrationSuite() with describe.skip, is outside the scan roots. A plain `it.skip("…", fn)`
// or `test.skip("…", fn)` call is allowed; the same function used as a value (a gate
// expression such as `const t = ok ? it : it.skip`) is not.
//
// Usage: node scripts/check-test-gating.mjs [repo-root]
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] ?? join(fileURLToPath(new URL(".", import.meta.url)), "..");

const RULES = [
  {
    re: /\bdescribe\s*\.\s*(skip|skipIf|runIf)\b/,
    why: "gates a suite by hand; use integrationSuite()",
  },
  {
    re: /\b(it|test)\s*\.\s*(skipIf|runIf)\b/,
    why: "gates a test by hand; use integrationSuite() around the suite",
  },
  {
    re: /\b(it|test)\s*\.\s*skip\b(?!\s*\()/,
    why: "uses it.skip/test.skip as a gate expression; use integrationSuite()",
  },
  {
    re: /\?\s*(describe|it|test)\b[\w.]*\s*:/,
    why: "selects describe/it/test with a ternary; use integrationSuite()",
  },
];

const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", ".astro"]);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.test\.tsx?$/.test(entry.name)) yield path;
  }
}

function* testFiles() {
  for (const group of ["packages", "apps"]) {
    let workspaces;
    try {
      workspaces = readdirSync(join(root, group), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ws of workspaces) {
      if (ws.isDirectory()) yield* walk(join(root, group, ws.name, "src"));
    }
  }
}

const hits = [];
let scanned = 0;
for (const file of testFiles()) {
  scanned++;
  const rel = relative(root, file);
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  // Match across the whole file so a gate split over lines (`? describe\n  : …`) still hits;
  // report each offending line once, under the first rule that matched it.
  const flagged = new Map();
  for (const rule of RULES) {
    for (const m of text.matchAll(new RegExp(rule.re.source, "g"))) {
      const line = text.slice(0, m.index).split("\n").length;
      if (!flagged.has(line)) flagged.set(line, rule.why);
    }
  }
  for (const [line, why] of [...flagged].sort((a, b) => a[0] - b[0])) {
    hits.push(`${rel}:${line}: ${why}\n    ${lines[line - 1].trim()}`);
  }
}

if (hits.length > 0) {
  console.error(`check-test-gating: ${hits.length} hand-rolled test gate(s):\n`);
  for (const hit of hits) console.error(`  ${hit}`);
  console.error(
    `\nGate integration, driver, and env-dependent suites with integrationSuite() from ` +
      `scripts/test-utils/integration.mjs so ASKDB_REQUIRE_INTEGRATION=1 can fail them in CI.`,
  );
  process.exit(1);
}

console.log(`check-test-gating: OK (${scanned} test files, no hand-rolled gates)`);
