// Where a test file may read the environment, for scripts/check-test-gating.mjs. While Vitest
// collects suites and tests, nothing may depend on the environment except through
// `integrationSuite()`; so the environment may be read only where that can't happen (ADR 0019).
import {
  forEachNode, isConstDeclaration, isGlobalName, isKeyedProperty, isLiteralToken, isMemberLink, linkName,
  outermostWrapper, propertyKey, ts, unwrap
} from "./ast.mjs";
import {
  constInitializer, definesTests, isInlineFunction, isProcessEnv, isProcessObject, isSuiteFactory,
  passedToTestHookOrFixture, readsEnvironment, usesOf,
  vitestCallKind,
} from "./bindings.mjs";

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
  forEachNode(sf, (node) => {
    if (readsEnvironment(node, bindings)) place(node);
  });
  // A `const` or function that reads the environment is placed like the read, at each use.
  while (pending.length > 0) {
    for (const use of usesOf(pending.pop(), bindings)) place(use);
  }
  return reported;
}

/**
 * Where `node` runs: `"allowed"` (a test body, a Vitest hook, an `integrationSuite()` call's
 * arguments), the declaration of the plain `const` or named function it sits in, or `"collection"`.
 */
function siteOf(node, bindings) {
  // `it("connects", run)`, `beforeAll(connect)`, `test.extend({ url })`: a named function passed as a
  // test body, hook or fixture runs after collection.
  if (namesFunction(node, bindings) && passedToTestHookOrFixture(node, bindings)) return "allowed";
  for (let child = node, n = node.parent; n !== undefined && !ts.isSourceFile(n); child = n, n = n.parent) {
    if (ts.isCallExpression(n) && n.arguments.includes(child) &&
      isSuiteFactory(unwrap(n.expression), bindings)) return "allowed";
    if (isConstDeclaration(n) && n.initializer === child) {
      // A named function: `const connect = () => …`.
      if (ts.isIdentifier(n.name) && isInlineFunction(unwrap(n.initializer))) return n;
      if (isPlainInitializer(n.initializer, bindings) && isPlainPattern(n.name, bindings) &&
        atCollection(n, bindings)) return n;
    }
    if (ts.isFunctionDeclaration(n) && n.name !== undefined) return n;
    // A suite body runs while Vitest collects; any callback other than a test body, hook or fixture may run then too.
    if (ts.isFunctionLike(n) && passedToTestHookOrFixture(n, bindings)) return "allowed";
  }
  return "collection";
}

/**
 * Whether destructuring pattern `name` takes only literal keys and plain defaults (`const { X = "" } = process.env`).
 */
function isPlainPattern(name, bindings) {
  if (ts.isIdentifier(name)) return true;
  return name.elements.every((el) => ts.isOmittedExpression(el) ||
    ((el.propertyName === undefined || typeof propertyKey(el.propertyName) === "string") &&
      (el.initializer === undefined || isPlainInitializer(el.initializer, bindings)) &&
        isPlainPattern(el.name, bindings)));
}

/** Whether `node` is a name for a function: a `function` declaration, or a `const` bound to an inline one. */
function namesFunction(node, bindings) {
  const decls = bindings.declarationsOf(node);
  return decls.length > 0 && decls.every(ts.isFunctionDeclaration) ||
    isInlineFunction(constInitializer(node, bindings) ?? node);
}

/** The declarations that bind the names `decl` declares: itself, or each element of its destructuring pattern. */
function declaredNames(decl) {
  if (!ts.isVariableDeclaration(decl) || ts.isIdentifier(decl.name)) return [decl];
  const names = [];
  forEachNode(decl.name, (node) => {
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) names.push(node);
  });
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

// What a plain `const` may read from `process` besides `process.env`: facts about the running
// process (`process.platform`, `process.cwd()`), which hold no configuration of their own.
const PROCESS_FACTS = new Set(["platform", "arch", "version", "versions", "execPath", "pid"]);
const PROCESS_CALLS = new Set(["cwd"]);

/**
 * Whether a `const`'s initializer is a plain value: a literal; `process` or `process.env`, or a
 * variable read from it with a literal name (`process.env.X`, `process.env["X"]`); a `PROCESS_FACTS` read or
 * `process.cwd()`; another plain `const`, or a name destructured from one; the global `undefined`;
 * an operator other than an assignment, `++` or `--` over plain values (`??`, `? :`, `===`, `!`);
 * a template over them; or an array or object literal of them. Such a `const` holds the environment without
 * acting on it while Vitest collects. Anything else (a call, `new`, a getter or `toString` method,
 * an assignment) may act on it, so it fails.
 */
function isPlainInitializer(node, bindings, seen = new Set()) {
  const plain = (n) => isPlainInitializer(n, bindings, seen);
  node = unwrap(node);
  if (isLiteralToken(node)) return true;
  if (ts.isTemplateExpression(node)) return node.templateSpans.every((span) => plain(span.expression));
  if (ts.isPrefixUnaryExpression(node)) {
    return node.operator !== ts.SyntaxKind.PlusPlusToken &&
      node.operator !== ts.SyntaxKind.MinusMinusToken && plain(node.operand);
  }
  if (ts.isBinaryExpression(node)) return !isAssignment(node.operatorToken.kind) &&
    plain(node.left) && plain(node.right);
  if (ts.isConditionalExpression(node)) return plain(node.condition) && plain(node.whenTrue) && plain(node.whenFalse);
  if (ts.isArrayLiteralExpression(node)) return node.elements.every(plain);
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every((p) =>
      isKeyedProperty(p, plain) ||
      (ts.isShorthandPropertyAssignment(p) && plain(p.name)));
  }
  if (isProcessObject(node, bindings) || isProcessEnv(node, bindings)) return true;
  if (isMemberLink(node)) {
    const owner = unwrap(node.expression);
    if (linkName(node) === undefined) return false;
    return isProcessEnv(owner, bindings) || (isProcessObject(owner, bindings) && PROCESS_FACTS.has(linkName(node))) ||
      (isMemberLink(owner) && linkName(owner) === "versions" && isProcessObject(unwrap(owner.expression), bindings));
  }
  if (ts.isCallExpression(node)) {
    const callee = unwrap(node.expression);
    return node.arguments.length === 0 && isMemberLink(callee) && PROCESS_CALLS.has(linkName(callee)) &&
      isProcessObject(unwrap(callee.expression), bindings);
  }
  if (!ts.isIdentifier(node)) return false;
  if (node.text === "undefined" && isGlobalName(node, bindings)) return true;
  const decls = bindings.declarationsOf(node);
  if (decls.length !== 1) return false;
  // `const { PG_URL } = process.env`: the `const` that destructures the name (its pattern is read
  // where it reads the environment, in `siteOf`).
  let [decl] = decls;
  while (ts.isBindingElement(decl)) decl = decl.parent.parent;
  // `seen` holds the `const`s being read on this path, so a cycle (`const a = b, b = a`) ends.
  if (!isConstDeclaration(decl) || seen.has(decl)) return false;
  seen.add(decl);
  try {
    return plain(decl.initializer);
  } finally {
    seen.delete(decl);
  }
}

function isAssignment(kind) {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

