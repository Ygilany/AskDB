#!/usr/bin/env node
// Fails when a test file gates a suite or test by hand instead of through
// `integrationSuite()` (scripts/test-utils/integration.mjs).
//
// Hand-rolled gates (`describe.skip`, `describe.skipIf(...)`, `cond ? describe : describe.skip`)
// skip silently when a prerequisite is missing, so CI's ASKDB_REQUIRE_INTEGRATION=1 can't turn
// a missing database or driver into a failure. `integrationSuite()` is the one sanctioned gate.
//
// Scans every *.test.ts / *.test.tsx in the pnpm workspace packages listed in
// pnpm-workspace.yaml (skipping node_modules, dist, and build caches). scripts/test-utils/,
// which implements integrationSuite() with describe.skip, is not a workspace package.
// Comments, string literals, template literals, and regex literals are blanked before
// matching, so text that merely mentions a gate does not trip the check.
//
// Allowed: a plain skipped test called directly, e.g. `it.skip("…", fn)`, `it.skip.each(…)(…)`.
// Rejected: see RULES. To exempt one line, put this comment on the line above it, with a reason:
//   // check-test-gating-ignore-next-line: <reason>
//
// Usage: node scripts/check-test-gating.mjs [repo-root]
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Not a member access (`obj.test`), not part of a longer identifier (`describeThing`).
const FN = String.raw`(?<![\w$.])`;
const CHAIN = String.raw`(?:\s*\.\s*\w+)*?`;

export const RULES = [
  {
    id: "suite-gate",
    re: new RegExp(String.raw`${FN}(?:describe|suite)${CHAIN}\s*\.\s*(?:skip|skipIf|runIf)\b`, "g"),
    why: "gates a suite by hand; use integrationSuite()",
  },
  {
    id: "test-gate",
    re: new RegExp(String.raw`${FN}(?:it|test)${CHAIN}\s*\.\s*(?:skipIf|runIf)\b`, "g"),
    why: "gates a test by hand; use integrationSuite() around the suite",
  },
  {
    // `.skip` that is never invoked is being passed around as a value: a gate expression.
    id: "skip-as-value",
    re: new RegExp(
      String.raw`${FN}(?:it|test)${CHAIN}\s*\.\s*skip\b(?!(?:\s*\.\s*\w+)*\s*[(\x60])`,
      "g",
    ),
    why: "uses it.skip/test.skip as a gate expression; use integrationSuite()",
  },
  {
    id: "ternary",
    re: /\?\s*(?:describe|suite|it|test)\b(?:\s*\.\s*\w+)*\s*:/g,
    why: "selects describe/suite/it/test with a ternary; use integrationSuite()",
  },
];

const PRAGMA = /\/\/\s*check-test-gating-ignore-next-line\b/;

const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw",
  "instanceof", "yield", "await",
]);

/**
 * Replace the contents of comments, string, template, and regex literals with spaces,
 * keeping newlines (so line numbers survive) and code inside `${…}` template expressions.
 * @param {string} src
 */
export function blankNonCode(src) {
  const out = src.split("");
  const n = src.length;
  const blank = (a, b) => {
    for (let k = a; k < Math.min(b, n); k++) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
  };
  // "code" | "brace" | "expr" (inside `${ }`) | "tpl" (template text)
  const stack = ["code"];
  let lastSig = ""; // last significant character outside literals; "w" for a word
  let lastWord = "";
  let i = 0;
  while (i < n) {
    const top = stack[stack.length - 1];
    const c = src[i];
    const d = src[i + 1];
    if (top === "tpl") {
      if (c === "\\") { blank(i, i + 2); i += 2; continue; }
      if (c === "`") { stack.pop(); lastSig = "w"; lastWord = ""; i++; continue; }
      if (c === "$" && d === "{") { stack.push("expr"); lastSig = "("; i += 2; continue; }
      blank(i, i + 1);
      i++;
      continue;
    }
    if (c === "/" && d === "/") {
      const e = src.indexOf("\n", i);
      const end = e === -1 ? n : e;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === "/" && d === "*") {
      const e = src.indexOf("*/", i + 2);
      const end = e === -1 ? n : e + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      blank(i + 1, j);
      lastSig = "w";
      lastWord = "";
      i = j + 1;
      continue;
    }
    if (c === "`") { stack.push("tpl"); i++; continue; }
    if (c === "/") {
      const regexAllowed =
        lastSig === "" ||
        "(,=:[!&|?{};+-*%<>~^}".includes(lastSig) ||
        (lastSig === "w" && REGEX_AFTER_WORD.has(lastWord));
      if (regexAllowed) {
        let j = i + 1;
        let inClass = false;
        while (j < n && src[j] !== "\n") {
          if (src[j] === "\\") { j += 2; continue; }
          if (src[j] === "[") inClass = true;
          else if (src[j] === "]") inClass = false;
          else if (src[j] === "/" && !inClass) break;
          j++;
        }
        blank(i + 1, j);
        lastSig = "w";
        lastWord = "";
        i = j + 1;
        continue;
      }
    }
    if (c === "{") stack.push("brace");
    else if (c === "}") {
      if (top === "expr") { stack.pop(); i++; continue; }
      if (top === "brace") stack.pop();
    }
    if (/\s/.test(c)) { i++; continue; }
    if (/[\w$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j++;
      lastSig = "w";
      lastWord = src.slice(i, j);
      i = j;
      continue;
    }
    lastSig = c;
    lastWord = "";
    i++;
  }
  return out.join("");
}

/**
 * Hand-rolled gates in one test file's source, one per line, under the first rule that matched.
 * @param {string} src
 * @returns {{ line: number; rule: string; why: string }[]}
 */
export function findGates(src) {
  const code = blankNonCode(src);
  const lines = src.split("\n");
  const ignored = new Set();
  lines.forEach((text, i) => {
    if (PRAGMA.test(text)) ignored.add(i + 2); // 1-based number of the next line
  });
  const flagged = new Map();
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    for (const m of code.matchAll(rule.re)) {
      const line = code.slice(0, m.index).split("\n").length;
      if (!ignored.has(line) && !flagged.has(line)) flagged.set(line, rule);
    }
  }
  return [...flagged]
    .sort((a, b) => a[0] - b[0])
    .map(([line, rule]) => ({ line, rule: rule.id, why: rule.why }));
}

/**
 * Workspace package directories from pnpm-workspace.yaml's `packages:` list.
 * Supports literal paths, a trailing `/*`, and `!` exclusions.
 * @param {string} root
 */
export function workspaceDirs(root) {
  const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8").split("\n");
  const start = yaml.findIndex((l) => /^packages:\s*$/.test(l));
  if (start === -1) throw new Error("pnpm-workspace.yaml has no `packages:` list");
  const include = [];
  const exclude = new Set();
  for (const raw of yaml.slice(start + 1)) {
    if (/^\S/.test(raw)) break; // next top-level key
    const m = raw.match(/^\s*-\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/);
    if (!m) continue; // blank or comment line
    const pattern = m[1];
    if (pattern.startsWith("!")) exclude.add(pattern.slice(1));
    else include.push(pattern);
  }
  const dirs = [];
  for (const pattern of include) {
    if (pattern.endsWith("/*") && !pattern.slice(0, -2).includes("*")) {
      const parent = pattern.slice(0, -2);
      if (!existsSync(join(root, parent))) continue;
      for (const e of readdirSync(join(root, parent), { withFileTypes: true })) {
        if (e.isDirectory()) dirs.push(`${parent}/${e.name}`);
      }
    } else if (pattern.includes("*")) {
      throw new Error(`check-test-gating: unsupported workspace pattern "${pattern}"; extend workspaceDirs()`);
    } else if (existsSync(join(root, pattern))) {
      dirs.push(pattern);
    }
  }
  return dirs.filter((d) => !exclude.has(d));
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", ".astro", ".lab"]);

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.test\.tsx?$/.test(entry.name)) yield path;
  }
}

function main() {
  const root = process.argv[2] ?? join(fileURLToPath(new URL(".", import.meta.url)), "..");
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
      const lines = src.split("\n");
      for (const hit of findGates(src)) {
        hits.push(`${relative(root, file)}:${hit.line}: ${hit.why}\n    ${lines[hit.line - 1].trim()}`);
      }
    }
  }

  if (scanned === 0) {
    console.error(`check-test-gating: found no test files under ${root}; refusing to pass an empty scan.`);
    process.exit(1);
  }
  if (hits.length > 0) {
    console.error(`check-test-gating: ${hits.length} hand-rolled test gate(s):\n`);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
