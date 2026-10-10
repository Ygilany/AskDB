// Where a test file may read the environment, for scripts/check-test-gating.mjs. While Vitest
// collects suites and tests, nothing may depend on the environment except through
// `integrationSuite()`; so the environment may be read only where that can't happen (ADR 0019).
import { isConstDeclaration, isValueReference, outermostWrapper, readsEnvironment, ts, unwrap } from "./ast.mjs";
import { definesTests, isInlineFunction, isSuiteFactory, isVitestHookCall, vitestCallKind } from "./bindings.mjs";

/**
 * The nodes in `sf` that read the environment where code runs while Vitest collects. The
 * environment may be read in a test body or a Vitest hook (which run after collection), in the
 * arguments of an `integrationSuite()` call, in a plain `const` (`const url = process.env.X`, see
 * `isPlainInitializer`), and in a named function (`function connect() {…}`, `const connect = () => …`).
 * Such a `const` or function may in turn be used only in those same places. Anything else (an `if`
 * at the top level or in a suite body, a callback run while collecting, a call of such a function
 * there) is reported.
 */
export function environmentReadsAtCollection(sf, bindings) {
  const reported = [];
  const readers = new Set();
  const pending = [];
  const place = (node) => {
    const site = siteOf(node, bindings);
    if (site === "allowed") return;
    if (site === "collection") {
      reported.push(node);
      return;
    }
    // `const { PG_URL } = process.env`: each name the declaration binds now holds the environment.
    for (const decl of declaredNames(site)) {
      if (readers.has(decl)) continue;
      readers.add(decl);
      pending.push(decl);
    }
  };
  const visit = (node) => {
    if (readsEnvironment(node, bindings)) place(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // A `const` or function that reads the environment is placed like the read, at each use.
  while (pending.length > 0) {
    const decl = pending.pop();
    const uses = (node) => {
      if (ts.isIdentifier(node) && isValueReference(node) && bindings.declarationsOf(node).includes(decl)) place(node);
      ts.forEachChild(node, uses);
    };
    uses(sf);
  }
  return reported;
}

/**
 * Where `node` runs: `"allowed"` (a test body, a Vitest hook, an `integrationSuite()` call's
 * arguments), the declaration of the plain `const` or named function it sits in, or `"collection"`.
 */
function siteOf(node, bindings) {
  for (let child = node, n = node.parent; n !== undefined && !ts.isSourceFile(n); child = n, n = n.parent) {
    if (ts.isCallExpression(n) && n.arguments.includes(child) && isSuiteFactory(unwrap(n.expression), bindings)) return "allowed";
    if (isConstDeclaration(n) && n.initializer === child) {
      // A named function: `const connect = () => …`.
      if (ts.isIdentifier(n.name) && isInlineFunction(unwrap(n.initializer))) return n;
      if (isPlainInitializer(n.initializer) && atCollection(n, bindings)) return n;
    }
    if (ts.isFunctionDeclaration(n) && n.name !== undefined) return n;
    if (!ts.isFunctionLike(n)) continue;
    const outer = outermostWrapper(n);
    const call = outer.parent;
    if (ts.isCallExpression(call) && call.arguments.includes(outer)) {
      if (definesTests(call, bindings) || isVitestHookCall(call, bindings)) return "allowed";
      // A suite body runs while Vitest collects; any other callback may run then too.
    }
  }
  return "collection";
}

/** The declarations that bind the names `decl` declares: itself, or each element of its destructuring pattern. */
function declaredNames(decl) {
  if (!ts.isVariableDeclaration(decl) || ts.isIdentifier(decl.name)) return [decl];
  const names = [];
  const visit = (node) => {
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) names.push(node);
    ts.forEachChild(node, visit);
  };
  visit(decl.name);
  return names;
}

/** Whether `node` runs while Vitest collects: not inside any function other than a suite body. */
function atCollection(node, bindings) {
  for (let n = node.parent; n !== undefined && !ts.isSourceFile(n); n = n.parent) {
    if (!ts.isFunctionLike(n)) continue;
    const outer = outermostWrapper(n);
    const call = outer.parent;
    if (!(ts.isCallExpression(call) && call.arguments.includes(outer) && vitestCallKind(call, bindings) !== undefined &&
      !definesTests(call, bindings))) return false;
  }
  return true;
}

/**
 * Whether a `const`'s initializer only reads values: no call other than a method of `process`
 * (`process.cwd()`), no `new`, no function, and no assignment, `++`, `--` or `delete`. Such a
 * `const` can hold the environment without acting on it while Vitest collects.
 */
function isPlainInitializer(node) {
  const acts = (n) => {
    if (ts.isFunctionLike(n) || ts.isNewExpression(n) || ts.isDeleteExpression(n) || ts.isTaggedTemplateExpression(n)) return true;
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      if (!(ts.isPropertyAccessExpression(callee) && ts.isIdentifier(unwrap(callee.expression)) && unwrap(callee.expression).text === "process")) return true;
    }
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(n.operator)) return true;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      return true;
    }
    return ts.forEachChild(n, (c) => (acts(c) ? true : undefined)) === true;
  };
  return !acts(node);
}
