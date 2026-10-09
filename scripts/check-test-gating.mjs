#!/usr/bin/env node
// Fails when a test file gates a suite or test by hand instead of through
// `integrationSuite()` (scripts/test-utils/integration.mjs).
//
// Hand-rolled gates (`describe.skip`, `describe.skipIf(...)`, `cond ? describe : describe.skip`,
// `describe(name, { skip: cond }, fn)`) skip silently when a prerequisite is missing, so CI's ASKDB_REQUIRE_INTEGRATION=1 can't turn
// a missing database or driver into a failure. `integrationSuite()` is the one sanctioned gate.
//
// Scans every *.test.ts / *.test.tsx in the pnpm workspace packages listed in
// pnpm-workspace.yaml (skipping node_modules, dist, and build caches). scripts/test-utils/,
// which implements integrationSuite() with describe.skip, is not a workspace package.
// Each file is parsed with the TypeScript compiler (`typescript`, a root devDependency), so
// comments, strings, templates, regexes and JSX text never trip a rule, and a file that does
// not parse fails the check instead of passing unread.
//
// Vitest is recognized as the globals, renamed imports (`import { it as t } from "vitest"`),
// namespace imports (`import * as v from "vitest"`) and variables holding `test.extend({…})`. A
// local declaration that shadows a name (a parameter `it`, an import of `test` from another
// module) is not Vitest's.
//
// Allowed: a plain skipped test called directly, e.g. `it.skip("…", fn)`, `it.skip.each(…)(…)`,
// `it("…", { skip: true }, fn)`, and tests defined in a loop (`for (const c of cases) it(…)`), which is parametrization.
// Rejected: see RULES, including a describe/suite/it/test call made only under a condition
// (`if`/`else`, `switch` cases, `try`/`catch`, `? :`, `&&`, `||`, `??`) anywhere between the
// call and the nearest enclosing suite, test or named function. To exempt one line, put a line
// comment on the line above it with a non-empty reason; the marker with no reason exempts nothing:
//   // check-test-gating-ignore-next-line: <reason>
//
// A use the check can't read (an alias such as `const d = describe`, `x && describe`, an
// argument, `describe.call(…)`, a spread or computed key in the options) fails closed.
//
// Known limits: an early `return` before a call, a gate inside a named helper that is called
// under a condition, options passed in a variable (`it(name, opts, fn)`), a test API imported
// from another module, and `ctx.skip()` inside a test body are not detected.
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
if (typeof ts.createSourceFile !== "function" || ts.SyntaxKind === undefined) {
  // TypeScript 7 moved the compiler API out of the package entry point (ADR 0019).
  console.error(`check-test-gating: needs the TypeScript 5/6 compiler API; typescript ${ts.version} doesn't export it (see docs/adrs/0019-test-gating-check-parses-with-typescript.md).`);
  process.exit(1);
}

const TEST_FNS = new Set(["describe", "suite", "it", "test"]);
const SUITE_FNS = new Set(["describe", "suite"]);
// Vitest's chainable modifiers. A call through any other link (`test.scoped`, `test.step`) is not
// treated as defining a suite or test; `test.extend({…})` returns a test function, read on.
const MODIFIERS = new Set([
  "skip", "only", "todo", "concurrent", "sequential", "shuffle", "fails", "each", "for", "skipIf", "runIf",
]);
const GATE_LINKS = new Set(["skipIf", "runIf"]);
const SUITE_GATE_LINKS = new Set(["skip", "skipIf", "runIf"]);
// Function-protocol links that call the function indirectly, so the check can't read the call.
const INDIRECT_LINKS = new Set(["call", "apply", "bind"]);

/** Whether `ref` gates by a link in `gateLinks`, a run-time modifier, or its options argument. */
function gatedByHand(ref, gateLinks) {
  return ref.links.some((l) => gateLinks.has(l)) || ref.computed || ref.optionGate;
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
    test: (ref) => !ref.invoked && isTernaryBranch(ref.top),
    why: "selects describe/suite/it/test with a ternary; use integrationSuite()",
  },
  {
    // A describe/suite/it/test call that only runs when a condition holds.
    id: "conditional-call",
    test: (ref) => ref.conditional,
    why: "defines a suite or test only under a condition; use integrationSuite()",
  },
  {
    // Anything else that isn't a direct call: an alias, an argument, `x && describe`,
    // `describe.call(…)`. The check can't follow the value, so it fails closed.
    id: "unclassified-use",
    test: (ref) => ref.escapes || ref.links.some((l) => INDIRECT_LINKS.has(l)),
    why: "uses describe/suite/it/test other than by calling it, so the check can't read the gate; call it directly or use integrationSuite()",
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
function outermostWrapper(node) {
  while (isWrapper(node.parent) && node.parent.expression === node) node = node.parent;
  return node;
}

/** `node` with its wrappers removed. */
function unwrap(node) {
  while (isWrapper(node)) node = node.expression;
  return node;
}

/** The callee of a call or the tag of a tagged template, or undefined for any other node. */
function calleeOf(node) {
  if (ts.isCallExpression(node)) return node.expression;
  if (ts.isTaggedTemplateExpression(node)) return node.tag;
  return undefined;
}

/** Whether `node` is a `.name` or `[key]` member access. */
function isMemberLink(node) {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
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
 * The file's names for Vitest's describe/suite/it/test: the globals, local names from
 * `import { it as t } from "vitest"`, and namespaces from `import * as v from "vitest"`.
 * @param {import("typescript").SourceFile} sf
 */
function vitestNames(sf) {
  const locals = new Map([...TEST_FNS].map((n) => [n, n]));
  const namespaces = new Set();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.moduleSpecifier.text !== "vitest") continue;
    const bindings = stmt.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        const imported = (el.propertyName ?? el.name).text;
        if (TEST_FNS.has(imported)) locals.set(el.name.text, imported);
      }
    }
  }
  const ctx = { sf, locals, namespaces, aliasDecls: new Set(), shadows: [] };
  // `const dbTest = test.extend({…})` is a test function too. Repeat for chains of `.extend`.
  for (let added = true; added; ) {
    added = false;
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && !locals.has(node.name.text)) {
        const fnName = extendedFn(node.initializer, ctx);
        if (fnName !== undefined) {
          locals.set(node.name.text, fnName);
          ctx.aliasDecls.add(node);
          added = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  ctx.shadows = shadowingDecls(ctx);
  return ctx;
}

/**
 * Local declarations that shadow a Vitest name (a parameter `it`, `const test = …`, an import of
 * `test` from another module), each with the node whose range it covers. `.extend` aliases and
 * imports from `vitest` are the Vitest names themselves, not shadows.
 */
function shadowingDecls(ctx) {
  const decls = [];
  const add = (name, scope) => {
    if (ts.isIdentifier(name)) {
      if (ctx.locals.has(name.text) || TEST_FNS.has(name.text)) decls.push({ name: name.text, scope });
    } else if (name && (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name))) {
      for (const el of name.elements) if (ts.isBindingElement(el)) add(el.name, scope);
    }
  };
  const blockScope = (node) => {
    let n = node.parent;
    while (n && !ts.isBlock(n) && !ts.isSourceFile(n) && !ts.isFunctionLike(n) && !ts.isCaseBlock(n) && !ts.isForStatement(n) &&
      !ts.isForOfStatement(n) && !ts.isForInStatement(n) && !ts.isCatchClause(n)) {
      n = n.parent;
    }
    return n;
  };
  const functionScope = (node) => {
    let n = node.parent;
    while (n && !ts.isSourceFile(n) && !ts.isFunctionLike(n)) n = n.parent;
    return n;
  };
  const visit = (node) => {
    if (ts.isParameter(node)) add(node.name, node.parent);
    else if (ts.isVariableDeclaration(node) && !ctx.aliasDecls.has(node)) {
      const list = node.parent;
      const isVar = ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.BlockScoped) === 0;
      add(node.name, ts.isCatchClause(list) ? list : isVar ? functionScope(node) : blockScope(node));
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) {
      add(node.name, blockScope(node));
    } else if ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name) {
      add(node.name, node);
    } else if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text !== "vitest") {
      const clause = node.importClause;
      if (clause?.name) add(clause.name, ctx.sf);
      const b = clause?.namedBindings;
      if (b && ts.isNamespaceImport(b)) add(b.name, ctx.sf);
      if (b && ts.isNamedImports(b)) for (const el of b.elements) add(el.name, ctx.sf);
    }
    ts.forEachChild(node, visit);
  };
  visit(ctx.sf);
  return decls;
}

/** Whether identifier `id` names a local declaration rather than Vitest's function. */
function isShadowed(id, ctx) {
  return ctx.shadows.some((d) => d.name === id.text && d.scope.pos <= id.pos && id.end <= d.scope.end);
}

/** The Vitest function an `x.extend(…)` call extends, or undefined for any other node. */
function extendedFn(node, ctx) {
  const callee = calleeOf(unwrap(node));
  if (callee === undefined) return undefined;
  const member = unwrap(callee);
  if (!isMemberLink(member) || linkName(member) !== "extend") return undefined;
  let base = unwrap(member.expression);
  while (testFnName(base, ctx) === undefined && isMemberLink(base) && linkName(base) !== undefined) {
    base = unwrap(base.expression);
  }
  return testFnName(base, ctx) ?? extendedFn(base, ctx);
}

/** The Vitest function `node` names (`describe`, `v.describe`, a renamed import), or undefined. */
function testFnName(node, ctx) {
  if (ts.isIdentifier(node)) return isShadowed(node, ctx) ? undefined : ctx.locals.get(node.text);
  if (
    isMemberLink(node) &&
    ts.isIdentifier(node.expression) &&
    ctx.namespaces.has(node.expression.text) &&
    TEST_FNS.has(linkName(node))
  ) {
    return linkName(node);
  }
  return undefined;
}

/**
 * Whether identifier `id` is a value reference, not a name: a member (`obj.test`), a declared
 * name (variable, parameter, function, property, method, enum member, type parameter, JSX
 * attribute), an import or export name, a label, a JSX tag, or a type.
 */
function isValueReference(id) {
  const parent = id.parent;
  if (parent.name === id) return ts.isShorthandPropertyAssignment(parent);
  if (parent.propertyName === id || parent.label === id) return false;
  if ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isJsxClosingElement(parent)) && parent.tagName === id) {
    return false;
  }
  return !(ts.isTypeReferenceNode(parent) || ts.isQualifiedName(parent) || ts.isTypeQueryNode(parent));
}

/**
 * A reference to Vitest's describe/suite/it/test, starting at the identifier or `v.describe`
 * node `start`: its `.modifier` links, the outermost expression of the chain (`top`), the call or
 * tagged template that invokes it, and what the rules need to know about that call.
 * `it.skip.each(rows)(name, fn)` counts as invoked, through the call `each(rows)` returns.
 */
function testRef(start, fnName, ctx) {
  const links = [];
  let computed = false;
  let top = start;
  for (;;) {
    const inner = outermostWrapper(top);
    const up = inner.parent;
    // `test.extend({…})` returns a test function: keep reading the chain through the call.
    if (links[links.length - 1] === "extend" && calleeOf(up) === inner) {
      top = up;
      continue;
    }
    if (!isMemberLink(up) || up.expression !== inner) break;
    const name = linkName(up);
    if (name === undefined) {
      // `describe[expr]`: a modifier chosen at run time can't be classified, so it fails closed.
      computed = true;
      top = up;
      break;
    }
    links.push(name);
    top = up;
  }
  top = outermostWrapper(top);
  let call;
  const p = top.parent;
  if (calleeOf(p) === top) {
    call = p;
    // `.each(rows)` / `.for(rows)` returns the function that defines the tests.
    const last = links[links.length - 1];
    const outer = outermostWrapper(call).parent;
    if ((last === "each" || last === "for") && ts.isCallExpression(outer) && outer.expression === outermostWrapper(call)) {
      call = outer;
    }
  }
  const suite = SUITE_FNS.has(fnName);
  // Links after the last `.extend`; a call through Vitest modifiers only defines a suite or test.
  const ownLinks = links.slice(links.lastIndexOf("extend") + 1);
  const defines = call !== undefined && links[links.length - 1] !== "extend" && ownLinks.every((l) => MODIFIERS.has(l));
  return {
    suite,
    links,
    computed,
    top,
    call,
    invoked: call !== undefined,
    escapes: call === undefined && !keptExtendResult(top, links),
    defines,
    conditional: defines && underCondition(call, ctx),
    optionGate: defines && hasGateOption(call, suite),
    line: ctx.sf.getLineAndCharacterOfPosition(start.getStart(ctx.sf)).line + 1,
  };
}

/**
 * Whether `top` is a `test.extend({…})` result the check can still follow: assigned to a variable
 * (tracked as a test function, see `vitestNames`) or discarded.
 */
function keptExtendResult(top, links) {
  if (links[links.length - 1] !== "extend" || calleeOf(top) === undefined) return false;
  const p = top.parent;
  return (ts.isVariableDeclaration(p) && p.initializer === top && ts.isIdentifier(p.name)) || ts.isExpressionStatement(p);
}

const SKIP_OPTIONS = new Set(["skip", "todo"]);

/** An options key as text, or null when it's computed at run time (`[expr]`). */
function optionKey(name) {
  if (!name) return undefined;
  if (ts.isComputedPropertyName(name)) {
    const expr = unwrap(name.expression);
    return ts.isStringLiteralLike(expr) || ts.isNumericLiteral(expr) ? expr.text : null;
  }
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}

/**
 * Whether a suite or test call skips through its options argument (`{ skip: cond }`,
 * `{ todo: cond }`, or options picked by `? :`, `&&`, `||` or `??`). A literal `skip: true` or
 * `todo: true` on a test is a plain skipped test, like `it.skip`; on a suite, `skip: true` is a
 * gate, like `describe.skip`.
 */
function hasGateOption(call, suite) {
  if (!ts.isCallExpression(call)) return false;
  let gate = false;
  const visit = (node, chosen) => {
    node = unwrap(node);
    if (ts.isConditionalExpression(node)) {
      visit(node.whenTrue, true);
      visit(node.whenFalse, true);
    } else if (ts.isBinaryExpression(node) && CONDITIONAL_OPERATORS.has(node.operatorToken.kind)) {
      visit(node.left, true);
      visit(node.right, true);
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        // A spread or a key computed at run time could carry `skip`; fail closed.
        if (ts.isSpreadAssignment(prop)) { gate = true; continue; }
        const key = optionKey(prop.name);
        if (key === null) { gate = true; continue; }
        if (!SKIP_OPTIONS.has(key)) continue;
        if (!ts.isPropertyAssignment(prop)) { gate = true; continue; } // shorthand, getter, method
        const value = unwrap(prop.initializer);
        const literal = value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword;
        if (chosen || !literal || (suite && key === "skip" && value.kind === ts.SyntaxKind.TrueKeyword)) gate = true;
      }
    }
  };
  for (const arg of call.arguments) visit(arg, false);
  return gate;
}

/** Whether `node` is the true or false branch of a `? :` (through wrappers). */
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
function underCondition(call, ctx) {
  let child = call;
  for (let node = call.parent; node && !ts.isSourceFile(node); child = node, node = node.parent) {
    if (conditionalEdge(node, child)) return true;
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isClassDeclaration(node)) return false;
    if (calleeOf(node) !== undefined && node !== call && callsVitestFn(node, ctx)) {
      return false;
    }
  }
  return false;
}

/** Whether a call or tagged template calls a Vitest describe/suite/it/test, through any links. */
function callsVitestFn(node, ctx) {
  let callee = calleeOf(node);
  if (ts.isCallExpression(callee)) callee = callee.expression; // `.each(rows)(…)`
  for (;;) {
    callee = unwrap(callee);
    if (testFnName(callee, ctx) !== undefined) return true;
    if (isMemberLink(callee)) callee = callee.expression;
    else if (extendedFn(callee, ctx) !== undefined) return true; // `test.extend({…})(…)`
    else return false;
  }
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
  const ctx = vitestNames(sf);
  const refs = [];
  const visit = (node) => {
    if (ts.isIdentifier(node) && isValueReference(node) && testFnName(node, ctx) !== undefined) {
      refs.push(testRef(node, testFnName(node, ctx), ctx));
    } else if (!ts.isIdentifier(node) && testFnName(node, ctx) !== undefined) {
      refs.push(testRef(node, testFnName(node, ctx), ctx));
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
 * `pnpm -r ls`, so `pnpm lint` doesn't spawn pnpm for one list it can read directly.
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
      // Split lines the way TypeScript counts them, so hit.line indexes the right one.
      const lines = src.split(/\r\n|[\r\n\u2028\u2029]/);
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
