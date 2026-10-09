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
// pnpm-workspace.yaml (skipping node_modules, dist, and build caches). scripts/test-utils/,
// which implements integrationSuite() with describe.skip, is not a workspace package.
// Each file is parsed with the TypeScript compiler (`typescript`, a root devDependency), so
// comments, strings, templates, regexes and JSX text never trip a rule, and a file that does
// not parse fails the check instead of passing unread.
//
// Vitest is recognized as the globals, renamed imports (`import { it as t } from "vitest"`),
// namespace imports (`import * as v from "vitest"`, `await import("vitest")`, `require("vitest")`
// through `require`, `module.require` or a `createRequire(…)` function, `import v = require(…)`,
// and a member read straight off a loader, `require("vitest").describe`) and variables holding
// `test.extend({…})`. `integrationSuite({…})` and a variable holding its result are suite
// functions, so the sanctioned gate passes. Names resolve through TypeScript's binder, so a local
// declaration that shadows one (a parameter `it`, an import of `test` from another module) is not
// Vitest's.
//
// What is rejected and allowed is listed once, in CONTRIBUTING.md ("Integration Tests"); RULES
// below implements it, and ADR 0019 (docs/adrs/0019-test-gating-check-parses-with-typescript.md)
// lists what the check can't see. A use the check can't read fails closed rather than passing. To exempt
// one line, put a line comment on the line above it with a non-empty reason:
//   // check-test-gating-ignore-next-line: <reason>
//
// Usage: node scripts/check-test-gating.mjs [repo-root]
import { readdirSync, readFileSync, existsSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The modules beside this file are loaded from its real path, so a symlinked or
// --preserve-symlinks-main invocation still finds them, and they find the repo's `typescript`.
const selfPath = realpathSync(fileURLToPath(import.meta.url));
const sibling = (name) => pathToFileURL(join(dirname(selfPath), "check-test-gating", name)).href;
const { ts, isWrapper, outermostWrapper, unwrap, calleeOf, isMemberLink, linkName, lineOf, oneFileProgram } = await import(sibling("ast.mjs"));
const { vitestBindings, isVitestLoaderCall, isVitestNamespace, integrationModuleResolver, isSuiteFactory, testFnName, extendedFn } =
  await import(sibling("bindings.mjs"));
const { workspaceDirs } = await import(sibling("workspace.mjs"));
export { integrationModuleResolver };

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
    test: (ref) => !ref.invoked && isTernaryBranch(ref.chain),
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

/**
 * Whether a Vitest namespace identifier is used in a form the check reads: `v.member`,
 * `v["member"]`, or `const w = v` / `const { describe } = v` (both resolved as aliases). A computed
 * key, a rest element or a nested pattern fails closed.
 */
function isReadableNamespaceUse(id) {
  let outer = outermostWrapper(id);
  // A loader is read through `await`: `(await import("vitest")).describe`. An `import()` that isn't
  // awaited is a promise (`.then(…)`, stored, passed on), which the check can't follow.
  if (ts.isCallExpression(id)) {
    if (!ts.isAwaitExpression(outer.parent) && id.expression.kind === ts.SyntaxKind.ImportKeyword) return false;
    while (ts.isAwaitExpression(outer.parent) || isWrapper(outer.parent)) outer = outer.parent;
  }
  const p = outer.parent;
  if (isMemberLink(p) && p.expression === outer) return linkName(p) !== undefined;
  if (!ts.isVariableDeclaration(p) || p.initializer !== outer) return false;
  if (ts.isIdentifier(p.name)) return true;
  // `const { describe, it: t } = v`: plain keys only, no rest, computed key or nesting.
  return ts.isObjectBindingPattern(p.name) && p.name.elements.every((el) =>
    !el.dotDotDotToken && ts.isIdentifier(el.name) && (!el.propertyName || ts.isIdentifier(el.propertyName)));
}

/** A ref with nothing to report, for `testRef` and `unreadableRef` to fill in. */
function emptyRef(start) {
  return {
    suite: false, links: [], computed: false, chain: start, invoked: false, escapes: false,
    conditional: false, optionGate: false, line: lineOf(start),
  };
}

/**
 * A use the check can't follow: a Vitest namespace or loader passed on (`fn(v)`, `import("vitest")
 * .then(…)`), `integrationSuite` or its module aliased, or `import d = v.x`. It fails closed.
 */
function unreadableRef(id) {
  return { ...emptyRef(id), escapes: true };
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
 * node `start`: its `.modifier` links, the outermost expression of the member chain (`chain`), the
 * call or tagged template that invokes it, and what the rules need to know about that call.
 * `it.skip.each(rows)(name, fn)` counts as invoked, through the call `each(rows)` returns.
 */
function testRef(start, fnName, bindings) {
  const links = [];
  let computed = false;
  let extendCallPending = false;
  let chain = start;
  for (;;) {
    const inner = outermostWrapper(chain);
    const up = inner.parent;
    // `test.extend({…})` returns a test function: read the chain on through that one call.
    if (extendCallPending && calleeOf(up) === inner) {
      extendCallPending = false;
      chain = up;
      continue;
    }
    if (!isMemberLink(up) || up.expression !== inner) break;
    const name = linkName(up);
    if (name === undefined) {
      // `describe[expr]`: a modifier chosen at run time can't be classified, so it fails closed.
      computed = true;
      chain = up;
      break;
    }
    links.push(name);
    extendCallPending = name === "extend";
    chain = up;
  }
  chain = outermostWrapper(chain);
  let call;
  let rows;
  let eachResultStored = false;
  let rowsSpread = false;
  const p = chain.parent;
  if (calleeOf(p) === chain) {
    call = p;
    // `.each(rows)` / `.for(rows)` returns the function that defines the tests.
    const last = links[links.length - 1];
    const outer = outermostWrapper(call).parent;
    if ((last === "each" || last === "for") && ts.isCallExpression(outer) && outer.expression === outermostWrapper(call)) {
      rows = ts.isCallExpression(call) ? call.arguments[0] : undefined;
      if (rows !== undefined && ts.isSpreadElement(rows)) rowsSpread = true;
      call = outer;
    } else if (last === "each" || last === "for") {
      eachResultStored = true;
    }
  }
  const suite = SUITE_FNS.has(fnName);
  // Links after the last `.extend`; a call through Vitest modifiers only defines a suite or test.
  const ownLinks = links.slice(links.lastIndexOf("extend") + 1);
  const defines = call !== undefined && !extendCallPending && ownLinks.every((l) => MODIFIERS.has(l));
  return {
    ...emptyRef(start),
    suite,
    links,
    computed,
    chain,
    invoked: call !== undefined,
    // `const t = it.each(rows)` stores the function that defines the tests, which the check can't follow.
    escapes: (call === undefined && !extendResultIsTracked(chain)) || eachResultStored,
    conditional: defines && underCondition(call, bindings),
    optionGate: defines && (hasGateOption(call, suite) || rowsSpread || (rows !== undefined && isChosen(rows))),
  };
}

/**
 * Whether a `test.extend({…})` or `integrationSuite({…})` result is one the check can still
 * follow: assigned to a variable (resolved as a test or suite function, see `vitestBindings`) or
 * discarded.
 */
function extendResultIsTracked(chain) {
  if (!ts.isCallExpression(chain)) return false;
  const p = chain.parent;
  return (ts.isVariableDeclaration(p) && p.initializer === chain && ts.isIdentifier(p.name)) || ts.isExpressionStatement(p);
}

const SKIP_OPTIONS = new Set(["skip", "todo"]);

// An options key computed at run time (`{ [expr]: … }`), which could be `skip`.
const RUNTIME_KEY = Symbol("runtime key");

/** An options key as text, `RUNTIME_KEY` for `[expr]`, or undefined for a name the check skips. */
function optionKey(name) {
  if (!name) return undefined;
  if (ts.isComputedPropertyName(name)) {
    const expr = unwrap(name.expression);
    return ts.isStringLiteralLike(expr) || ts.isNumericLiteral(expr) ? expr.text : RUNTIME_KEY;
  }
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}

/** Whether `node` is `a && b`, `a || b`, `a ?? b` or one of their assignment forms. */
function isBinaryChoice(node) {
  return ts.isBinaryExpression(node) && CONDITIONAL_OPERATORS.has(node.operatorToken.kind);
}

/**
 * Whether `node` (through wrappers) is picked at run time by `? :`, `&&`, `||` or `??`, or is an
 * array literal that spreads such a pick.
 */
function isChosen(node) {
  node = unwrap(node);
  if (ts.isConditionalExpression(node) || isBinaryChoice(node)) return true;
  // `[a, ...(cond ? [b] : [])]`: how many rows there are depends on the condition.
  return ts.isArrayLiteralExpression(node) && node.elements.some((el) => ts.isSpreadElement(el) && isChosen(el.expression));
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
    } else if (isBinaryChoice(node)) {
      visit(node.left, true);
      visit(node.right, true);
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        // A spread or a key computed at run time could carry `skip`; fail closed.
        if (ts.isSpreadAssignment(prop)) { gate = true; continue; }
        const key = optionKey(prop.name);
        if (key === RUNTIME_KEY) { gate = true; continue; }
        if (!SKIP_OPTIONS.has(key)) continue;
        if (!ts.isPropertyAssignment(prop)) { gate = true; continue; } // shorthand, getter, method
        const value = unwrap(prop.initializer);
        const literal = value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword;
        if (chosen || !literal || (suite && key === "skip" && value.kind === ts.SyntaxKind.TrueKeyword)) gate = true;
      }
    }
  };
  for (const arg of call.arguments) {
    // `describe(...args)`: the options could be in there, unread; fail closed.
    if (ts.isSpreadElement(arg)) return true;
    visit(arg, false);
  }
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
  if (isBinaryChoice(parent)) return child === parent.right;
  // A `try` block with a `catch` runs only up to its first throw; the `catch` only after one.
  if (ts.isTryStatement(parent)) return child === parent.tryBlock && parent.catchClause !== undefined;
  // A loop or iteration callback over a table picked by a condition, like a `.each` table.
  if ((ts.isForOfStatement(parent) || ts.isForInStatement(parent)) && child === parent.statement) return isChosen(parent.expression);
  if (ts.isCallExpression(parent) && parent.arguments.includes(child) && isMemberLink(unwrap(parent.expression))) {
    if (isChosen(unwrap(parent.expression).expression)) return true;
  }
  // `a?.b(arg)`, `a?.[key]`: the arguments and key run only when the chain doesn't short-circuit.
  if (ts.isCallExpression(parent) && ts.isOptionalChain(parent) && parent.arguments.includes(child)) return true;
  if (ts.isElementAccessExpression(parent) && ts.isOptionalChain(parent) && child === parent.argumentExpression) return true;
  // A default value runs only when the value is `undefined`: in a declaration, a parameter, or a
  // destructuring assignment (`[a = x] = …`, `({ a = x } = …)`).
  if ((ts.isBindingElement(parent) || ts.isParameter(parent)) && child === parent.initializer) return true;
  if (ts.isShorthandPropertyAssignment(parent) && child === parent.objectAssignmentInitializer) return true;
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && child === parent.right &&
    isAssignmentPatternElement(parent)) {
    return true;
  }
  return ts.isCaseClause(parent) || ts.isDefaultClause(parent) || ts.isCatchClause(parent);
}

/**
 * Whether a suite or test call runs only under a condition, looking outward to the nearest
 * enclosing suite or test call (which is checked on its own), named function, or the file.
 * Plain loops and `forEach`/`map`/`flatMap` callbacks are not conditions; a loop over an iterable
 * a condition picks is one (see `conditionalEdge`), and so is a callback passed to any other call.
 */
function underCondition(call, bindings) {
  let child = call;
  // Set once the walk leaves a function, until a call it's passed to (directly or inside an
  // argument such as `{ onReady: () => … }`) is reached.
  let inCallback = false;
  let grandchild;
  for (let node = call.parent; node && !ts.isSourceFile(node); grandchild = child, child = node, node = node.parent) {
    if (conditionalEdge(node, child)) return true;
    if (ts.isFunctionDeclaration(node)) return false;
    // A class member that runs later (a method, accessor, constructor or instance field) is a
    // boundary; a static block, static field or `extends` clause runs when the class does.
    if (ts.isClassLike(node)) {
      // A member's computed key and decorators run with the class, like a static block.
      const viaKeyOrDecorator = grandchild !== undefined && (child.name === grandchild || ts.isDecorator(grandchild));
      if (isDeferredClassMember(child) && !viaKeyOrDecorator) return false;
      continue;
    }
    if (calleeOf(node) !== undefined && node !== call && callsVitestFn(node, bindings)) {
      return false;
    }
    if (ts.isFunctionLike(node) && !ts.isClassStaticBlockDeclaration(node)) inCallback = true;
    // A callback handed to any other call (`.then`, `setTimeout`, `new Promise`, a helper) may run
    // later or never.
    if (inCallback && ts.isTaggedTemplateExpression(node) && child === node.template) return true;
    // `(async () => { … })().catch(…)`: a throw before the call is swallowed, so it may never run.
    if (inCallback && ts.isCallExpression(node) && unwrap(node.expression) === unwrap(child) && rejectionSwallowed(node)) return true;
    if (inCallback && (ts.isCallExpression(node) || ts.isNewExpression(node)) && node.arguments?.includes(child)) {
      if (!isIterationCall(node)) return true;
      inCallback = false;
    }
  }
  return false;
}

/** Whether `a = x` is an element of a destructuring assignment target, not a plain assignment. */
function isAssignmentPatternElement(binary) {
  let node = binary;
  let p = node.parent;
  if (!(ts.isArrayLiteralExpression(p) || ts.isPropertyAssignment(p))) return false;
  while (ts.isArrayLiteralExpression(p) || ts.isObjectLiteralExpression(p) || ts.isPropertyAssignment(p) || ts.isSpreadElement(p) ||
    ts.isParenthesizedExpression(p)) {
    node = p;
    p = p.parent;
  }
  if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.left === node) return true;
  return (ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.initializer === node;
}

/** Whether a class member's body runs after the class is defined, not while it is. */
function isDeferredClassMember(member) {
  if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member) || ts.isAccessor(member)) return true;
  if (!ts.isPropertyDeclaration(member)) return false;
  return !(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static);
}

/** Whether a call's result is handed to `.catch(…)` or a two-argument `.then(…)`. */
function rejectionSwallowed(call) {
  const outer = outermostWrapper(call);
  const member = outer.parent;
  if (!isMemberLink(member) || member.expression !== outer) return false;
  const handler = outermostWrapper(member).parent;
  if (!ts.isCallExpression(handler) || handler.expression !== outermostWrapper(member)) return false;
  const name = linkName(member);
  return name === "catch" || (name === "then" && handler.arguments.length >= 2);
}

// Array methods whose callback runs once per element, now: parametrization, like a loop.
const ITERATION_METHODS = new Set(["forEach", "map", "flatMap"]);

/** Whether `node` is `rows.forEach(cb)`, `rows.map(cb)` or `rows.flatMap(cb)`. */
function isIterationCall(node) {
  const callee = ts.isCallExpression(node) ? unwrap(node.expression) : undefined;
  return callee !== undefined && isMemberLink(callee) && ITERATION_METHODS.has(linkName(callee));
}

/** Whether a call or tagged template defines a suite or test: Vitest's describe/suite/it/test through modifier links. */
function callsVitestFn(node, bindings) {
  let callee = calleeOf(node);
  // `test.extend({…})` or `test.scoped({…})` defines nothing, so the walk goes on past it.
  const outer = unwrap(callee);
  if (isMemberLink(outer) && !MODIFIERS.has(linkName(outer)) && testFnName(outer, bindings) === undefined) return false;
  for (;;) {
    callee = unwrap(callee);
    if (testFnName(callee, bindings) !== undefined || extendedFn(callee, bindings) !== undefined) return true;
    if (isMemberLink(callee)) callee = callee.expression;
    else if (calleeOf(callee) !== undefined) callee = calleeOf(callee); // `.each(rows)(…)`, `.each\`table\`(…)`
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
  const name = kind === ts.ScriptKind.TSX ? "/file.test.tsx" : "/file.test.ts";
  const sf = ts.createSourceFile(name, src, ts.ScriptTarget.Latest, true, kind);
  const program = oneFileProgram(sf);
  const d = program.getSyntacticDiagnostics(sf)[0];
  if (d) {
    const line = sf.getLineAndCharacterOfPosition(d.start ?? 0).line + 1;
    throw new Error(`does not parse at line ${line}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  }
  const bindings = vitestBindings(program, isIntegrationModule);
  const refs = [];
  const visit = (node) => {
    if (!ts.isIdentifier(node) || isValueReference(node)) {
      const fnName = testFnName(node, bindings);
      if (fnName !== undefined) refs.push(testRef(node, fnName, bindings));
      else if (((ts.isIdentifier(node) && isVitestNamespace(node, bindings)) || isVitestLoaderCall(node, bindings)) && !isReadableNamespaceUse(node)) {
        refs.push(unreadableRef(node));
      }
    }
    // `integrationSuite` (or its module's namespace) used other than by calling it: an alias the
    // check can't follow, such as `const g = integrationSuite`.
    if (ts.isIdentifier(node) && isValueReference(node)) {
      const bindingKind = bindings.resolve(node)?.kind;
      const outer = outermostWrapper(node);
      if (bindingKind === "suiteFactory" && calleeOf(outer.parent) !== outer) refs.push(unreadableRef(node));
      // `I.isIntegrationRequired()` and other named members read through; `I.integrationSuite` must be called.
      const member = isMemberLink(outer.parent) && outer.parent.expression === outer ? outer.parent : undefined;
      const readable = member !== undefined && linkName(member) !== undefined &&
        (!isSuiteFactory(member, bindings) || calleeOf(outermostWrapper(member).parent) === outermostWrapper(member));
      if (bindingKind === "integrationNs" && !readable) {
        refs.push(unreadableRef(node));
      }
    }
    // `import d = v.<name>` other than `v.describe`/`v.it`/…: an alias the check can't follow.
    if (ts.isImportEqualsDeclaration(node) && ts.isQualifiedName(node.moduleReference) && bindings.resolve(node.name)?.kind !== "fn") {
      let root = node.moduleReference;
      while (ts.isQualifiedName(root)) root = root.left;
      if (isVitestNamespace(root, bindings)) refs.push(unreadableRef(node.moduleReference));
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

const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", ".astro", ".lab"]);

/** Whether a symbolic link points at a directory; a dangling or looping link points at none. */
function linksToDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// Follows symbolic links to directories, as Vitest does, visiting each real directory once.
function* walk(dir, seen = new Set()) {
  const real = realpathSync(dir);
  if (seen.has(real)) return;
  seen.add(real);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    const isDir = entry.isDirectory() || (entry.isSymbolicLink() && linksToDirectory(path));
    if (isDir) yield* walk(path, seen);
    else if (/\.test\.tsx?$/.test(entry.name)) yield path;
  }
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
