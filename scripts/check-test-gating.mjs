#!/usr/bin/env node
// Fails when a test file gates a suite or test by hand instead of through
// `integrationSuite()` (scripts/test-utils/integration.mjs).
//
// Hand-rolled gates (`describe.skip`, `describe.skipIf(...)`, `cond ? describe : describe.skip`,
// `describe(name, { skip: cond }, fn)`) skip silently when a prerequisite is missing, so CI's
// ASKDB_REQUIRE_INTEGRATION=1 can't turn a missing database or driver into a failure.
// `integrationSuite()` is the one sanctioned gate.
//
// Scans every *.test.ts / *.test.tsx in the pnpm workspace packages listed in
// pnpm-workspace.yaml (skipping node_modules, dist and .git, as Vitest does). scripts/test-utils/,
// which implements integrationSuite() with describe.skip, is not a workspace package.
// Each file is parsed with the TypeScript compiler (`typescript`, a root devDependency), so
// comments, strings, templates, regexes and JSX text never trip a rule, and a file that does
// not parse fails the check instead of passing unread.
//
// Vitest is recognized as the globals, renamed imports (`import { it as t } from "vitest"`),
// namespace imports (`import * as v from "vitest"`, the loaders `isLoaderCall` and
// `isVitestLoaderCall` in check-test-gating/bindings.mjs read, in-source `import.meta.vitest`, and a
// member read straight off a loader, `require("vitest").describe`) and variables holding
// `test.extend({…})`. `integrationSuite({…})` and a variable holding its result
// are suite functions, so the sanctioned gate passes.
// A suite body's first parameter is the test API Vitest passes it; a suite's body must be inline,
// and a test's may also be a `const` bound to a function. Names resolve through
// TypeScript's binder, so any other local declaration that shadows one (a callback's parameter
// `it`, an import of `test` from another module) is not Vitest's.
//
// The check accepts only plain forms and fails everything else. CONTRIBUTING.md ("Integration
// Tests") is the one list of those forms and of what the check can't see; ADR 0019
// (docs/adrs/0019-test-gating-check-parses-with-typescript.md) records why. Each module under
// check-test-gating/ owns one part (placement, arguments, tables, environment), and RULES below
// reports them.
// To exempt one line, put a line comment on the line above it with a non-empty reason:
//   // check-test-gating-ignore-next-line: <reason>
//
// Usage: node scripts/check-test-gating.mjs [repo-root]
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The modules beside this file are loaded from its real path, so a symlinked or
// --preserve-symlinks-main invocation still finds them, and they find the repo's `typescript`.
const selfPath = realpathSync(fileURLToPath(import.meta.url));
const moduleUrl = (name) => pathToFileURL(join(dirname(selfPath), "check-test-gating", name)).href;
const { INDIRECT_LINKS, ts, oneFileProgram } = await import(moduleUrl("ast.mjs"));
const { GATE_LINKS, SUITE_GATE_LINKS, vitestBindings, integrationModuleResolver } =
  await import(moduleUrl("bindings.mjs"));
const { collectRefs, pragmaLines } = await import(moduleUrl("refs.mjs"));
const { workspaceDirs, walk } = await import(moduleUrl("workspace.mjs"));

/** Whether `ref` gates by a link in `gateLinks`, a run-time modifier, or its options argument. */
function gatedByHand(ref, gateLinks) {
  return ref.links.some((l) => gateLinks.has(l)) || ref.runtimeModifier || ref.runtimeGate;
}

export const RULES = [
  {
    id: "suite-gate",
    test: (ref) => ref.suite && gatedByHand(ref, SUITE_GATE_LINKS),
    why: "gates a suite by hand; use integrationSuite()",
  },
  {
    id: "test-gate",
    test: (ref) => !ref.suite && gatedByHand(ref, GATE_LINKS),
    why: "gates a test by hand; use integrationSuite() around the suite",
  },
  {
    // `.skip` that is never invoked is being passed around as a value: a gate expression.
    id: "skip-as-value",
    test: (ref) => !ref.suite && ref.links.includes("skip") && !ref.invoked,
    why: "uses it.skip/test.skip as a gate expression; use integrationSuite()",
  },
  {
    id: "ternary",
    test: (ref) => !ref.invoked && isTernaryBranch(ref.chain),
    why: "selects describe/suite/it/test with a ternary; use integrationSuite()",
  },
  {
    // A describe/suite/it/test call outside straight-line code (see placement.mjs).
    id: "conditional-call",
    test: (ref) => ref.conditional,
    why: "defines a suite or test outside straight-line code (under a condition, in a loop, a callback or a helper, or after " +
      "an early exit); define it directly, and use integrationSuite() for one that needs the environment",
  },
  {
    // Anything outside the plain forms: an alias, `describe.call(…)`, a kept result, arguments or a
    // `.each` table the check can't read. It fails closed.
    id: "unclassified-use",
    test: (ref) => ref.unreadable || ref.links.some((l) => INDIRECT_LINKS.has(l)),
    why:
      "uses describe/suite/it/test in a way the check can't read (an alias, a kept result, or arguments or a table " +
      "outside the plain forms); call it directly with an inline body, literal options and a literal or const table, or use integrationSuite()",
  },
  {
    // The environment read where code runs while Vitest collects (see environment.mjs).
    id: "collection-env",
    test: (ref) => ref.environment,
    why: "reads the environment while Vitest collects suites; read it in a test, a hook, a plain const or integrationSuite()'s " +
      "options, so nothing that defines a suite or table depends on it",
  },
];

/** Whether `node` is the true or false branch of a `? :` (through wrappers). */
function isTernaryBranch(node) {
  const p = node.parent;
  return ts.isConditionalExpression(p) && (p.whenTrue === node || p.whenFalse === node);
}

/**
 * Hand-rolled gates in one test file's source, one per line, under the first rule that matched.
 * Throws when the file does not parse, so the check fails closed instead of skipping it.
 * @param {string} src
 * @param {string} [fileName] decides TS or TSX parsing by extension
 * @param {{ isIntegrationModule?: (specifier: string) => boolean }} [options] which import specifiers
 *   name the sanctioned gate (see `integrationModuleResolver`); by default none does, so an
 *   `integrationSuite` the check can't place fails closed
 * @returns {{ line: number; rule: string; why: string }[]}
 */
export function findGates(src, fileName = "file.test.ts", { isIntegrationModule = () => false } = {}) {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  // The one-file program's key, not `fileName`: it only has to end in the right extension.
  const virtualPath = kind === ts.ScriptKind.TSX ? "/file.test.tsx" : "/file.test.ts";
  const sf = ts.createSourceFile(virtualPath, src, ts.ScriptTarget.Latest, true, kind);
  const program = oneFileProgram(sf);
  const d = program.getSyntacticDiagnostics(sf)[0];
  if (d) {
    const line = sf.getLineAndCharacterOfPosition(d.start ?? 0).line + 1;
    throw new Error(`does not parse at line ${line}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  }
  const bindings = vitestBindings(program, isIntegrationModule);
  const refs = collectRefs(sf, bindings);

  const ignored = pragmaLines(sf);
  const flagged = new Map();
  for (const rule of RULES) {
    for (const ref of refs) {
      if (rule.test(ref) && !ignored.has(ref.line) && !flagged.has(ref.line)) flagged.set(ref.line, rule);
    }
  }
  return [...flagged]
    .sort((a, b) => a[0] - b[0])
    .map(([line, rule]) => ({ line, rule: rule.id, why: rule.why }));
}

function main() {
  const root = process.argv[2] ?? join(dirname(selfPath), "..");
  let dirs;
  try {
    dirs = workspaceDirs(root);
  } catch (error) {
    console.error(`check-test-gating: cannot read the workspace at ${root}: ${error.message}`);
    process.exit(1);
  }

  const hits = [];
  let scanned = 0;
  for (const dir of dirs) {
    for (const file of walk(join(root, dir))) {
      scanned++;
      const src = readFileSync(file, "utf8");
      // Split lines the way TypeScript counts them, so hit.line indexes the right one.
      const lines = src.split(/\r\n|[\r\n\u2028\u2029]/);
      let gates;
      try {
        gates = findGates(src, file, { isIntegrationModule: integrationModuleResolver(root, file) });
      } catch (error) {
        hits.push(`${relative(root, file)}: cannot be checked (${error.message})`);
        continue;
      }
      for (const hit of gates) {
        hits.push(`${relative(root, file)}:${hit.line}: ${hit.why}\n    ${lines[hit.line - 1].trim()}`);
      }
    }
  }

  if (scanned === 0) {
    console.error(`check-test-gating: found no test files under ${root}; refusing to pass an empty scan.`);
    process.exit(1);
  }
  if (hits.length > 0) {
    console.error(`check-test-gating: ${hits.length} hand-rolled test gate(s) or unreadable file(s):\n`);
    for (const hit of hits) console.error(`  ${hit}`);
    console.error(
      `\nGate integration, driver, and env-dependent suites with integrationSuite() from ` +
        `scripts/test-utils/integration.mjs so ASKDB_REQUIRE_INTEGRATION=1 can fail them in CI. ` +
        `To exempt one line, add "// check-test-gating-ignore-next-line: <reason>" above it.`,
    );
    process.exit(1);
  }
  console.log(`check-test-gating: OK (${scanned} test files in ${dirs.length} workspace packages, no hand-rolled gates)`);
}

// Compare real paths on both sides: argv[1] keeps the typed (possibly symlinked) path, and
// import.meta.url is resolved through symlinks unless --preserve-symlinks-main is set.
const invokedPath = process.argv[1] && existsSync(process.argv[1]) ? realpathSync(process.argv[1]) : "";
if (invokedPath === selfPath) main();
