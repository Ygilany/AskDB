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
// Each file is parsed with the TypeScript compiler (`typescript`, a root devDependency), so
// comments, strings, templates, regexes and JSX text never trip a rule, and a file that does
// not parse fails the check instead of passing unread.
//
// Allowed: a plain skipped test called directly, e.g. `it.skip("…", fn)`, `it.skip.each(…)(…)`,
// and tests defined in a loop (`for (const c of cases) it(…)`), which is parametrization.
// Rejected: see RULES, including a describe/suite/it/test call made only under a condition
// (`if`/`else`, `switch` cases, `try`/`catch`, `? :`, `&&`, `||`, `??`) anywhere between the
// call and the nearest enclosing suite, test or named function. To exempt one line, put a line
// comment on the line above it with a non-empty reason; the marker with no reason exempts nothing:
//   // check-test-gating-ignore-next-line: <reason>
//
// Known limits: an early `return` before a call, a gate behind a helper or alias
// (`const d = describe`, a named function called under a condition), and `ctx.skip()` inside a
// test body are not detected.
//
// Usage: node scripts/check-test-gating.mjs [repo-root]
import { readdirSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve `typescript` from this file's real location, so a symlinked or
// --preserve-symlinks-main invocation still finds the repo's install.
const selfPath = realpathSync(fileURLToPath(import.meta.url));
const ts = createRequire(selfPath)("typescript");

const TEST_FNS = new Set(["describe", "suite", "it", "test"]);
const SUITE_FNS = new Set(["describe", "suite"]);
// Vitest's chainable modifiers. A chain with any other link (`test.extend`, `test.step`) is not
// treated as defining a suite or test.
const MODIFIERS = new Set([
  "skip", "only", "todo", "concurrent", "sequential", "shuffle", "fails", "each", "for", "skipIf", "runIf",
]);

export const RULES = [
  {
    id: "suite-gate",
    test: (ref) => SUITE_FNS.has(ref.base) && ref.links.some((l) => l === "skip" || l === "skipIf" || l === "runIf"),
    why: "gates a suite by hand; use integrationSuite()",
  },
  {
    id: "test-gate",
    test: (ref) => !SUITE_FNS.has(ref.base) && ref.links.some((l) => l === "skipIf" || l === "runIf"),
    why: "gates a test by hand; use integrationSuite() around the suite",
  },
  {
    // `.skip` that is never invoked is being passed around as a value: a gate expression.
    id: "skip-as-value",
    test: (ref) => !SUITE_FNS.has(ref.base) && ref.links.includes("skip") && !ref.invoked,
    why: "uses it.skip/test.skip as a gate expression; use integrationSuite()",
  },
  {
    id: "ternary",
    test: (ref) => !ref.invoked && isTernaryBranch(ref.top),
    why: "selects describe/suite/it/test with a ternary; use integrationSuite()",
  },
  {
    // A describe/suite/it/test call that only runs when a condition holds.
    id: "conditional-call",
    test: (ref) => ref.invoked && ref.links.every((l) => MODIFIERS.has(l)) && underCondition(ref.call),
    why: "defines a suite or test only under a condition; use integrationSuite()",
  },
];

const PRAGMA = /^\/\/\s*check-test-gating-ignore-next-line\s*:\s*\S/;

// Wrappers that leave the value unchanged: `(x)`, `x!`, `x as T`, `<T>x`, `x satisfies T`.
function isWrapper(node) {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node)
  );
}

/** The outermost wrapper around `node`, or `node` itself. */
function stripParens(node) {
  while (isWrapper(node.parent) && node.parent.expression === node) node = node.parent;
  return node;
}

/** The property name of a `.name` or `["name"]` link, or undefined. */
function linkName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return undefined;
}

/**
 * A reference to Vitest's describe/suite/it/test: the identifier, its `.modifier` links, the
 * outermost expression of the chain (`top`), and the call or tagged template that invokes it.
 * `it.skip.each(rows)(name, fn)` counts as invoked, through the call `each(rows)` returns.
 * @param {import("typescript").Identifier} id
 */
function testRef(id) {
  const parent = id.parent;
  if (!TEST_FNS.has(id.text)) return undefined;
  // Only a value reference: not `obj.test`, `{ test: … }`, a declaration, an import or a type.
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return undefined;
  if (
    (ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)) &&
    parent.name === id
  ) {
    return undefined;
  }
  if (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent)) {
    if (parent.name === id) return undefined;
  }
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isTypeReferenceNode(parent)) return undefined;
  if (ts.isQualifiedName(parent) || ts.isExportSpecifier(parent) || ts.isBindingElement(parent)) return undefined;

  const links = [];
  let top = id;
  for (;;) {
    const up = stripParens(top).parent;
    const name = linkName(up);
    if (name === undefined || up.expression !== stripParens(top)) break;
    links.push(name);
    top = up;
  }
  top = stripParens(top);
  let call;
  const p = top.parent;
  if ((ts.isCallExpression(p) && p.expression === top) || (ts.isTaggedTemplateExpression(p) && p.tag === top)) {
    call = p;
    // `.each(rows)` / `.for(rows)` returns the function that defines the tests.
    const last = links[links.length - 1];
    const outer = stripParens(call).parent;
    if ((last === "each" || last === "for") && ts.isCallExpression(outer) && outer.expression === stripParens(call)) {
      call = outer;
    }
  }
  return { base: id.text, links, top, call, invoked: call !== undefined, line: lineOf(id) };
}

let currentFile;
function lineOf(node) {
  return currentFile.getLineAndCharacterOfPosition(node.getStart(currentFile)).line + 1;
}

/** Whether `node` is the true or false branch of a `? :` (through parentheses). */
function isTernaryBranch(node) {
  const p = node.parent;
  return ts.isConditionalExpression(p) && (p.whenTrue === node || p.whenFalse === node);
}

const CONDITIONAL_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** Whether the node `child` of `parent` runs only when a condition holds. */
function conditionalEdge(parent, child) {
  if (ts.isIfStatement(parent)) return child !== parent.expression;
  if (ts.isConditionalExpression(parent)) return child !== parent.condition;
  if (ts.isBinaryExpression(parent)) return CONDITIONAL_OPERATORS.has(parent.operatorToken.kind) && child === parent.right;
  // A `try` block with a `catch` runs only up to its first throw; the `catch` only after one.
  if (ts.isTryStatement(parent)) return child === parent.tryBlock && parent.catchClause !== undefined;
  return ts.isCaseClause(parent) || ts.isDefaultClause(parent) || ts.isCatchClause(parent);
}

/**
 * Whether a suite or test call runs only under a condition, looking outward to the nearest
 * enclosing suite or test call (which is checked on its own), named function, or the file.
 * Loops are not conditions.
 */
function underCondition(call) {
  let child = call;
  for (let node = call.parent; node && !ts.isSourceFile(node); child = node, node = node.parent) {
    if (conditionalEdge(node, child)) return true;
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isClassDeclaration(node)) return false;
    if ((ts.isCallExpression(node) || ts.isTaggedTemplateExpression(node)) && node !== call && isTestCall(node)) {
      return false;
    }
  }
  return false;
}

function isTestCall(node) {
  let callee = ts.isCallExpression(node) ? node.expression : node.tag;
  if (ts.isCallExpression(callee)) callee = callee.expression; // `.each(rows)(…)`
  for (;;) {
    if (isWrapper(callee) || linkName(callee) !== undefined) callee = callee.expression;
    else break;
  }
  return ts.isIdentifier(callee) && TEST_FNS.has(callee.text);
}

/** Line numbers exempted by a `// check-test-gating-ignore-next-line: <reason>` comment. */
function pragmaLines(sf) {
  const text = sf.text;
  const seen = new Set();
  const lines = new Set();
  // Trivia scanning from a token next to JSX text would read `// …` in that text as a comment.
  const jsxText = [];
  const collectJsxText = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) jsxText.push([node.pos, node.end]);
    ts.forEachChild(node, collectJsxText);
  };
  collectJsxText(sf);
  const inJsxText = (pos) => jsxText.some(([a, b]) => pos >= a && pos < b);
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) return;
    if (node.kind < ts.SyntaxKind.FirstNode || node.kind === ts.SyntaxKind.EndOfFileToken) {
      const comments = [
        ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
        ...(ts.getTrailingCommentRanges(text, node.end) ?? []),
      ];
      for (const c of comments) {
        if (seen.has(c.pos) || c.kind !== ts.SyntaxKind.SingleLineCommentTrivia || inJsxText(c.pos)) continue;
        seen.add(c.pos);
        if (PRAGMA.test(text.slice(c.pos, c.end))) lines.add(sf.getLineAndCharacterOfPosition(c.pos).line + 2);
      }
    }
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  return lines;
}

/** The file's syntax errors, through a one-file program (no type-checking, no emit, no I/O). */
function syntaxErrors(sf) {
  const host = {
    getSourceFile: (n) => (n === sf.fileName ? sf : undefined),
    fileExists: (n) => n === sf.fileName,
    readFile: () => undefined,
    getDefaultLibFileName: () => "/lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (n) => n,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const options = { noLib: true, noResolve: true, jsx: ts.JsxEmit.Preserve };
  return ts.createProgram([sf.fileName], options, host).getSyntacticDiagnostics(sf);
}

/**
 * Hand-rolled gates in one test file's source, one per line, under the first rule that matched.
 * Throws when the file does not parse, so the check fails closed instead of skipping it.
 * @param {string} src
 * @param {string} [fileName] decides TS or TSX parsing by extension
 * @returns {{ line: number; rule: string; why: string }[]}
 */
export function findGates(src, fileName = "file.test.ts") {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const name = kind === ts.ScriptKind.TSX ? "/file.test.tsx" : "/file.test.ts";
  const sf = ts.createSourceFile(name, src, ts.ScriptTarget.Latest, true, kind);
  const d = syntaxErrors(sf)[0];
  if (d) {
    const line = sf.getLineAndCharacterOfPosition(d.start ?? 0).line + 1;
    throw new Error(`does not parse at line ${line}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  }
  currentFile = sf;
  const refs = [];
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      const ref = testRef(node);
      if (ref) refs.push(ref);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

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

/**
 * Workspace package directories from pnpm-workspace.yaml's `packages:` list.
 * Supports literal paths, a trailing `/*`, and `!` exclusions; anything else throws, so the
 * check fails closed rather than skipping a package. Parsed here rather than asking
 * `pnpm -r ls` so the check needs no pnpm process and no install.
 * @param {string} root
 */
function workspaceDirs(root) {
  const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8").split("\n");
  const start = yaml.findIndex((l) => /^packages:\s*$/.test(l));
  if (start === -1) throw new Error("pnpm-workspace.yaml has no `packages:` list");
  const include = [];
  const exclude = new Set();
  for (const raw of yaml.slice(start + 1)) {
    if (/^\s*(?:#.*)?$/.test(raw)) continue; // blank or comment line, at any indent
    if (/^[A-Za-z_][\w-]*\s*:/.test(raw)) break; // next top-level key
    const m = raw.match(/^\s*-\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/);
    if (!m) throw new Error(`unrecognized line in the \`packages:\` list: ${JSON.stringify(raw)}`);
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
      let gates;
      try {
        gates = findGates(src, file);
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
