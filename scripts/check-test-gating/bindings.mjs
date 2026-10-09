// Resolves names in a test file to Vitest's describe/suite/it/test and to integrationSuite(), for
// scripts/check-test-gating.mjs.
import { dirname, resolve } from "node:path";
import { calleeOf, calleeParts, firstParameter, isMemberLink, linkName, memberOn, propertyKey, outermostWrapper, resultOf, ts, unwrap } from "./ast.mjs";

const TEST_FNS = new Set(["describe", "suite", "it", "test"]);
// What `bindings.resolve()` finds a name to be, each spelt in one place.
export const KIND_FN = "fn"; // a Vitest test or suite function, with its `name`
const KIND_NS = "ns"; // a Vitest namespace
export const KIND_SUITE_FACTORY = "suiteFactory"; // `integrationSuite`
export const KIND_INTEGRATION_NS = "integrationNs"; // a namespace import of integrationSuite's module
const KIND_REQUIRE = "require"; // a function from `createRequire(…)`
export const KIND_AMBIGUOUS = "ambiguous"; // declarations that disagree about a Vitest value
// What `vitestCallKind()` finds a call to define.
export const CALL_SUITE = "suite";
export const CALL_TEST = "test";
const CALL_ROWS = "rows"; // a `.each` or `.for` call, whose body receives a table row
const SUITE_FNS = new Set(["describe", "suite"]);
// Links whose suite body receives a table row, not the test API: `describe.each(rows)(name, (row) => …)`.
export const ROW_LINKS = new Set(["each", "for"]);
// Modifiers that skip a test by a condition.
export const GATE_LINKS = new Set(["skipIf", "runIf"]);
// Modifiers that skip a suite. `describe.todo(name, fn)` never runs the suite's tests, like `describe.skip`.
export const SUITE_GATE_LINKS = new Set(["skip", "todo", ...GATE_LINKS]);
// Vitest's chainable modifiers. A call through any other link (`test.step`, `test.runIf.foo`) is not
// treated as defining a suite or test; an `EXTENDERS` call returns a test function, read on.
export const MODIFIERS = new Set([
  ...SUITE_GATE_LINKS, ...ROW_LINKS, "only", "concurrent", "sequential", "shuffle", "fails",
  // `it.describe` is Vitest's `describe`.
  ...SUITE_FNS,
]);
// Links whose call returns a new test function: `test.extend({…})`, `test.override({…})`, `test.scoped({…})`.
export const EXTENDERS = new Set(["extend", "override", "scoped"]);
// Member calls that load a module by name: `module.require`, `vi.importActual`, `vi.importMock`.
const MEMBER_LOADERS = new Set(["require", "importActual", "importMock"]);
// Of those, the ones that return a promise, as `import()` does.
const PROMISE_MEMBER_LOADERS = new Set(["importActual", "importMock"]);

/** The module an import declaration names, through its specifier, clause or binding. */
function importedFrom(decl) {
  let n = decl;
  while (n && !ts.isImportDeclaration(n)) n = n.parent;
  return n && ts.isStringLiteral(n.moduleSpecifier) ? n.moduleSpecifier.text : undefined;
}

/**
 * Whether identifier `id` names a global (`Number`, `Array`, `process`, `undefined`): the file
 * declares nothing it resolves to. The check's program has no lib, so a built-in has no declaration
 * and a local shadow (`const Array = …`, a parameter named `undefined`) has one.
 */
export function isGlobalName(id, bindings) {
  return ts.isIdentifier(id) && bindings.declarationsOf(id).length === 0;
}

/** Whether `node` reads an environment variable: `process.env.X`, `process.env["X"]`, `env.X` from `node:process`, or a name destructured from one. */
export function isEnvRead(node, bindings) {
  // `const { PG_URL } = process.env`: a name destructured from the environment.
  if (ts.isIdentifier(node)) {
    const decls = bindings.declarationsOf(node);
    return decls.length === 1 && ts.isBindingElement(decls[0]) && ts.isObjectBindingPattern(decls[0].parent) &&
      ts.isVariableDeclaration(decls[0].parent.parent) && decls[0].parent.parent.initializer !== undefined &&
      isEnvObject(decls[0].parent.parent.initializer, bindings);
  }
  return isMemberLink(node) && isEnvObject(node.expression, bindings);
}

/** Whether `node` is the environment object: the global `process.env`, or `env` imported from `"process"` / `"node:process"`. */
function isEnvObject(node, bindings) {
  node = unwrap(node);
  if (ts.isIdentifier(node)) {
    const decls = bindings.declarationsOf(node);
    return decls.length === 1 && ts.isImportSpecifier(decls[0]) && (decls[0].propertyName ?? decls[0].name).text === "env" &&
      ["process", "node:process"].includes(importedFrom(decls[0]));
  }
  if (!ts.isPropertyAccessExpression(node) || node.name.text !== "env") return false;
  const process = unwrap(node.expression);
  return ts.isIdentifier(process) && process.text === "process" && isGlobalName(process, bindings);
}

/**
 * Whether the plain name `call` is made through is a global: the callee of `Number(…)`, or the
 * object of `Array.from(…)` / `Math.max(…)`, through wrappers. Any other callee isn't.
 */
export function isGlobalCallee(call, bindings) {
  const callee = unwrap(call.expression);
  return isGlobalName(isMemberLink(callee) ? unwrap(callee.expression) : callee, bindings);
}

/**
 * Resolves names to Vitest's describe/suite/it/test with the binder of a one-file program, so
 * JavaScript scoping decides: an unresolved name is a Vitest global, an import from `vitest` is
 * Vitest, a variable holding `x.extend({…})` of a Vitest function is a test function, a suite
 * body's first parameter is the test API Vitest passes it, and any other declaration (a callback's
 * parameter `it`, an import of `test` from another module) is not Vitest's.
 */
export function vitestBindings(program, isIntegrationModule) {
  const checker = program.getTypeChecker();
  const cache = new Map();
  // Which import specifiers name the sanctioned gate's module.
  const bindings = { isIntegrationModule };
  /**
   * The symbol identifier `id` names as a value: in a shorthand property (`{ vi }`) the variable it
   * reads, not the property it declares.
   */
  const valueSymbol = (id) => {
    const parent = id.parent;
    return ts.isShorthandPropertyAssignment(parent) && parent.name === id
      ? checker.getShorthandAssignmentValueSymbol(parent)
      : checker.getSymbolAtLocation(id);
  };
  /** The declarations of the value identifier `id` names (see `valueSymbol`), or none. */
  bindings.declarationsOf = (id) => valueSymbol(id)?.declarations ?? [];
  /**
   * What identifier `id` refers to, as `{ kind, name? }` with one of the `KIND_*` constants above
   * (`name` for `KIND_FN`; `KIND_AMBIGUOUS` is explained at `resolveDeclarations`), or undefined.
   */
  bindings.resolve = (id) => {
    const symbol = valueSymbol(id);
    if (symbol === undefined) return TEST_FNS.has(id.text) ? { kind: KIND_FN, name: id.text } : undefined;
    if (cache.has(symbol)) return cache.get(symbol);
    cache.set(symbol, undefined); // a cycle (`const t = t.extend(…)`) resolves to nothing
    const found = resolveDeclarations(symbol, bindings);
    cache.set(symbol, found);
    return found;
  };
  return bindings;
}

/** Whether `node` is `import.meta.vitest`, Vitest's in-source test API (through wrappers). */
function isImportMetaVitest(node) {
  if (!ts.isPropertyAccessExpression(node) || node.name.text !== "vitest") return false;
  const meta = unwrap(node.expression);
  return ts.isMetaProperty(meta) && meta.keywordToken === ts.SyntaxKind.ImportKeyword && meta.name.text === "meta";
}

/**
 * Whether `node` (through wrappers and `await`) is the Vitest module: `import("vitest")`,
 * `require("vitest")`, `import.meta.vitest`, or an identifier bound to a Vitest namespace.
 */
function resolvesToVitestModule(node, bindings) {
  node = resultOf(node);
  // `import v = require("vitest")`: the declaration, not a use of the module.
  if (ts.isExternalModuleReference(node)) return isVitestSpecifier(node.expression);
  return isVitestModuleUse(node, bindings);
}

/**
 * Whether `node` itself, with nothing unwrapped, is a use of the Vitest module: `import.meta.vitest`,
 * a loader call, or an identifier bound to a Vitest namespace.
 */
export function isVitestModuleUse(node, bindings) {
  if (isImportMetaVitest(node)) return true;
  if (ts.isIdentifier(node)) return isVitestNamespace(node, bindings);
  return isVitestLoaderCall(node, bindings);
}

/** Whether `node` is `createRequire(…)` or `module.createRequire(…)`. */
function isCreateRequireCall(node) {
  return calleeParts(node)?.name === "createRequire";
}

/** Whether `node` (through parentheses and casts) is the string `"vitest"`. */
function isVitestSpecifier(node) {
  node = node && unwrap(node);
  return node !== undefined && ts.isStringLiteralLike(node) && node.text === "vitest";
}

/** Whether loader callee `callee` returns a promise: `import` or `vi.importActual` / `vi.importMock`. */
export function isPromiseLoader(callee) {
  return callee.kind === ts.SyntaxKind.ImportKeyword || (isMemberLink(callee) && PROMISE_MEMBER_LOADERS.has(linkName(callee)));
}

/**
 * Whether `node` takes `vi.importActual` or `vi.importMock` off its object without calling it there
 * (`const ia = vi.importActual`, `vi.importActual.call(vi, "vitest")`). The module the detached loader
 * loads isn't read, so a use like this fails closed. Destructuring `vi` (`const { importActual } = vi`)
 * is `isUnreadableViUse`'s.
 */
export function isDetachedLoader(node) {
  if (!isMemberLink(node) || !PROMISE_MEMBER_LOADERS.has(linkName(node))) return false;
  const outer = outermostWrapper(node);
  return calleeOf(outer.parent) !== outer;
}

/**
 * Whether `node` is Vitest's `vi` used other than through a member written out (`vi.fn()`,
 * `vi["mock"]`): passed on (`Reflect.get(vi, …)`), read by a computed key (`vi[k]`), or destructured
 * or aliased. Its loaders load Vitest, so a use the check can't name fails closed.
 */
export function isUnreadableViUse(node, bindings) {
  if (!namesVi(node, bindings)) return false;
  const member = memberOn(node);
  return member === undefined || linkName(member) === undefined;
}

// Vitest hooks, whose callbacks run after the suites and tests are collected.
const HOOKS = new Set(["beforeAll", "beforeEach", "afterAll", "afterEach", "onTestFinished", "onTestFailed"]);

/**
 * Whether `call` calls a Vitest hook: the global (`beforeAll(…)`), an import from `"vitest"` (renamed
 * or not), or a member of a Vitest namespace or loader (`v.afterEach(…)`). A local function or an
 * object's method of the same name is not Vitest's.
 */
export function isVitestHookCall(call, bindings) {
  const callee = unwrap(call.expression);
  if (isMemberLink(callee)) return HOOKS.has(linkName(callee)) && resolvesToVitestModule(callee.expression, bindings);
  if (!ts.isIdentifier(callee)) return false;
  const decls = bindings.declarationsOf(callee);
  if (decls.length === 0) return HOOKS.has(callee.text);
  return decls.every((d) => ts.isImportSpecifier(d) && importedFrom(d) === "vitest" && HOOKS.has((d.propertyName ?? d.name).text));
}

// Vitest's `vi` object, under both names it exports (`const vi = vitest`).
const VI_NAMES = new Set(["vi", "vitest"]);

/**
 * Whether `node` is Vitest's `vi` (or `vitest`, the same object): the global, an import from `"vitest"` (renamed or not), a name
 * destructured from a Vitest module (`const { vi: m } = v`), or read off one (`v.vi`,
 * `require("vitest").vi`, `import.meta.vitest.vi`).
 */
function namesVi(node, bindings) {
  if (isMemberLink(node)) return VI_NAMES.has(linkName(node)) && resolvesToVitestModule(node.expression, bindings);
  if (!ts.isIdentifier(node)) return false;
  const decls = bindings.declarationsOf(node);
  if (decls.length === 0) return VI_NAMES.has(node.text);
  return decls.every((d) => (ts.isImportSpecifier(d) && importedFrom(d) === "vitest" && VI_NAMES.has((d.propertyName ?? d.name).text)) ||
    destructuresVi(d, bindings));
}

/** Whether declaration `d` is `{ vi }`, `{ vi: m }` or `{ vitest }` destructured from a Vitest module. */
function destructuresVi(d, bindings) {
  if (!ts.isBindingElement(d) || !VI_NAMES.has(propertyKey(d.propertyName ?? d.name))) return false;
  const decl = d.parent.parent;
  return ts.isVariableDeclaration(decl) && decl.initializer !== undefined && resolvesToVitestModule(decl.initializer, bindings);
}

/** Whether `node` is `import("vitest")` or `require("vitest")` (a string or plain template). */
function isVitestLoaderCall(node, bindings) {
  if (!ts.isCallExpression(node) || !isVitestSpecifier(node.arguments[0])) return false;
  const callee = unwrap(node.expression);
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return true; // `import("vitest")`, `import("vitest", opts)`
  // `require`, `module.require`, `globalThis.require`, or a function from `createRequire(…)`.
  if (ts.isIdentifier(callee)) return callee.text === "require" || kindOf(callee, bindings) === KIND_REQUIRE;
  // `module.require`, `globalThis.require`, and Vitest's own `vi.importActual` / `vi.importMock`.
  return isMemberLink(callee) && MEMBER_LOADERS.has(linkName(callee));
}

/** Whether identifier `id` names a Vitest namespace. */
function isVitestNamespace(id, bindings) {
  return kindOf(id, bindings) === KIND_NS;
}

/**
 * The rule for which import names the sanctioned gate: a relative specifier that resolves, from the
 * test file's directory, to `<root>/scripts/test-utils/integration.mjs`. A package-local copy at
 * the same suffix is not it.
 * @param {string} root the repo root
 * @param {string} file the test file's path
 */
export function integrationModuleResolver(root, file) {
  const target = resolve(root, "scripts", "test-utils", "integration.mjs");
  return (specifier) => specifier.startsWith(".") && resolve(dirname(file), specifier) === target;
}

/** Whether `node` is a call of `integrationSuite(…)`, which returns `describe` or its sanctioned gate. */
function suiteFactoryCall(node, bindings) {
  return ts.isCallExpression(node) && isSuiteFactory(unwrap(node.expression), bindings);
}

/** Whether `node` names `integrationSuite`: the import, or `I.integrationSuite` on a namespace import of its module. */
export function isSuiteFactory(node, bindings) {
  if (ts.isIdentifier(node)) return kindOf(node, bindings) === KIND_SUITE_FACTORY;
  return isMemberLink(node) && linkName(node) === "integrationSuite" && ts.isIdentifier(unwrap(node.expression)) &&
    kindOf(unwrap(node.expression), bindings) === KIND_INTEGRATION_NS;
}

/**
 * The Vitest function `node` names (`describe`, `v.describe`, a renamed import, an `.extend` alias),
 * or undefined. An `integrationSuite(…)` call stands for `describe`, which is how the sanctioned gate
 * counts as a suite.
 */
export function testFnName(node, bindings) {
  if (suiteFactoryCall(node, bindings)) return "describe";
  if (ts.isIdentifier(node)) {
    const found = bindings.resolve(node);
    return found?.kind === KIND_FN ? found.name : undefined;
  }
  // `v.describe`, `require("vitest").describe`, `(await import("vitest")).describe`.
  if (isMemberLink(node) && resolvesToVitestModule(node.expression, bindings)) {
    const name = linkName(node);
    return TEST_FNS.has(name) ? name : undefined;
  }
  return undefined;
}

/** The Vitest function an `x.extend(…)` call extends, or undefined for any other node. */
function extendedFn(node, bindings) {
  const callee = calleeOf(unwrap(node));
  if (callee === undefined) return undefined;
  const member = unwrap(callee);
  if (!isMemberLink(member) || !EXTENDERS.has(linkName(member))) return undefined;
  let base = unwrap(member.expression);
  while (testFnName(base, bindings) === undefined && isMemberLink(base) && linkName(base) !== undefined) {
    base = unwrap(base.expression);
  }
  return testFnName(base, bindings) ?? extendedFn(base, bindings);
}

/**
 * Whether a reference to Vitest function `fnName`, through `links` (the ones after its last
 * `.extend`), defines a suite: `describe(…)`, `it.describe(…)`. The one suite test for
 * `vitestCallKind` and the reference walk in `refs.mjs`.
 */
export function definesSuite(fnName, links) {
  return SUITE_FNS.has(fnName) || links.some((l) => SUITE_FNS.has(l));
}

/**
 * What a call or tagged template defines through Vitest's describe/suite/it/test and modifier
 * links: `CALL_SUITE`, `CALL_TEST`, `CALL_ROWS` (a `.each` or `.for` call, whose body receives a row), or
 * undefined when it defines nothing (`test.extend({…})`, `test.scoped({…})`, any other call).
 */
export function vitestCallKind(node, bindings) {
  let callee = calleeOf(node);
  if (callee === undefined) return undefined;
  const outer = unwrap(callee);
  if (isMemberLink(outer) && !MODIFIERS.has(linkName(outer)) && testFnName(outer, bindings) === undefined) return undefined;
  const links = [];
  for (;;) {
    callee = unwrap(callee);
    // `test.extend({…}).describe(…)`: the walk goes on past a call that returns a test function.
    const name = testFnName(callee, bindings) ?? extendedFn(callee, bindings);
    if (name !== undefined) {
      if (links.some((l) => ROW_LINKS.has(l))) return CALL_ROWS;
      return definesSuite(name, links) ? CALL_SUITE : CALL_TEST;
    }
    if (isMemberLink(callee)) {
      links.push(linkName(callee));
      callee = callee.expression;
    } else if (calleeOf(callee) !== undefined) {
      callee = calleeOf(callee); // `describe.skipIf(c)(…)`, `.each(rows)(…)`, `.each\`table\`(…)`
    } else {
      return undefined;
    }
  }
}

/**
 * Whether function `fn` is a suite body: an argument of a call that defines a suite through Vitest
 * (`describe(…)`, `describe.skipIf(c)(…)`, `it.describe(…)`, an `integrationSuite(…)` result), which
 * Vitest calls with the suite's test API. A `.each` or `.for` body receives a table row instead.
 */
function isSuiteBody(fn, bindings) {
  if (!isInlineFunction(fn)) return false;
  const outer = outermostWrapper(fn);
  const call = outer.parent;
  return ts.isCallExpression(call) && call.arguments.includes(outer) && vitestCallKind(call, bindings) === CALL_SUITE;
}

/** The initializer of the one `const` that declares `node`, an identifier, unwrapped, or undefined (any other node too). */
export function constInitializer(node, bindings) {
  if (!ts.isIdentifier(node)) return undefined;
  const decls = bindings.declarationsOf(node);
  if (decls.length !== 1) return undefined;
  const [d] = decls;
  if (!ts.isVariableDeclaration(d) || !ts.isIdentifier(d.name) || !d.initializer) return undefined;
  if (!ts.isVariableDeclarationList(d.parent) || !(d.parent.flags & ts.NodeFlags.Const)) return undefined;
  return unwrap(d.initializer);
}

// The `const` initializers `constHolds` is reading through, so a cycle (`const a = b, b = a`) ends.
const following = new Set();

/**
 * Whether `node` is a name bound by one `const` whose initializer passes `test`, reading each
 * initializer once per walk. The one way the check follows a `const` to its value.
 */
export function constHolds(node, bindings, test) {
  const init = constInitializer(node, bindings);
  if (init === undefined || following.has(init)) return false;
  following.add(init);
  try {
    return test(init);
  } finally {
    following.delete(init);
  }
}

export function isInlineFunction(node) {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

/** The parameter a binding element destructures, through nested patterns, or undefined. */
function parameterOf(element) {
  let n = element;
  while (ts.isBindingElement(n) || ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) n = n.parent;
  return ts.isParameter(n) ? n : undefined;
}

/** Whether parameter `param` receives the test API: the first parameter of a suite body. */
function isTestApiParameter(param, bindings) {
  return firstParameter(param.parent) === param && isSuiteBody(param.parent, bindings);
}

/**
 * What a variable's initializer makes it: a Vitest namespace (`const w = v`, `await import("vitest")`),
 * a `require` (`createRequire(…)`), or a test or suite function (`integrationSuite({…})`,
 * `test.extend({…})`, `require("vitest").describe`).
 */
function resolveInitializer(init, bindings) {
  const fn = testFnName(init, bindings) ?? extendedFn(init, bindings);
  if (fn !== undefined) return { kind: KIND_FN, name: fn };
  if (resolvesToVitestModule(init, bindings)) return { kind: KIND_NS };
  return isCreateRequireCall(init) ? { kind: KIND_REQUIRE } : undefined;
}

/**
 * What one declaration makes a name: the `{ kind, … }` record `resolve()` returns, or undefined.
 * A variable's initializer goes through `resolveInitializer`.
 */
function kindOfDeclaration(decl, bindings) {
  const { isIntegrationModule } = bindings;
  let found;
  if (decl && ts.isImportSpecifier(decl) && importedFrom(decl) === "vitest") {
    const imported = (decl.propertyName ?? decl.name).text;
    if (TEST_FNS.has(imported)) found = { kind: KIND_FN, name: imported };
  } else if (decl && ts.isNamespaceImport(decl) && importedFrom(decl) === "vitest") {
    found = { kind: KIND_NS };
  } else if (decl && ts.isImportEqualsDeclaration(decl) && resolvesToVitestModule(decl.moduleReference, bindings)) {
    found = { kind: KIND_NS }; // `import v = require("vitest")`
  } else if (decl && ts.isImportEqualsDeclaration(decl) && ts.isQualifiedName(decl.moduleReference)) {
    // `import d = v.describe`, on a Vitest namespace. A longer name (`v.describe.skip`) fails closed
    // in findGates.
    const { left, right } = decl.moduleReference;
    if (ts.isIdentifier(left) && isVitestNamespace(left, bindings) && TEST_FNS.has(right.text)) found = { kind: KIND_FN, name: right.text };
  } else if (decl && ts.isImportSpecifier(decl) && (decl.propertyName ?? decl.name).text === "integrationSuite" &&
    isIntegrationModule(importedFrom(decl) ?? "")) {
    found = { kind: KIND_SUITE_FACTORY };
  } else if (decl && ts.isNamespaceImport(decl) && isIntegrationModule(importedFrom(decl) ?? "")) {
    found = { kind: KIND_INTEGRATION_NS }; // `import * as I from ".../integration.mjs"`
  } else if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
    found = resolveInitializer(unwrap(decl.initializer), bindings);
  } else if (decl && ts.isParameter(decl) && isTestApiParameter(decl, bindings)) {
    // `describe("db", (test) => { test.skipIf(…)(…) })`. A rest parameter holds the API in an array.
    found = ts.isIdentifier(decl.name) && !decl.dotDotDotToken ? { kind: KIND_FN, name: "test" } : { kind: KIND_AMBIGUOUS };
  } else if (decl && ts.isBindingElement(decl) && parameterOf(decl) !== undefined) {
    // `describe("db", ({ skipIf }) => …)`: the test API taken apart, which the check can't follow.
    if (isTestApiParameter(parameterOf(decl), bindings)) found = { kind: KIND_AMBIGUOUS };
  } else if (decl && ts.isBindingElement(decl) && ts.isObjectBindingPattern(decl.parent)) {
    // `const { describe } = v`, from a Vitest namespace.
    const holder = decl.parent.parent;
    const init = ts.isVariableDeclaration(holder) && holder.initializer ? unwrap(holder.initializer) : undefined;
    const key = decl.propertyName ?? decl.name;
    if (init && resolvesToVitestModule(init, bindings) && ts.isIdentifier(key) && TEST_FNS.has(key.text)) {
      found = { kind: KIND_FN, name: key.text };
    }
  }
  return found;
}

/**
 * Resolves a name across all of its declarations. Type-only declarations and a `var` without an
 * initializer say nothing about the value. When several value declarations remain and they don't
 * agree on a Vitest function or namespace (`var t = test.extend({}); var t = other;`, or a
 * destructuring or parameter that redeclares it), the name is `ambiguous` and fails closed.
 */
function resolveDeclarations(symbol, bindings) {
  const decls = (symbol.declarations ?? []).filter((d) =>
    !ts.isTypeAliasDeclaration(d) && !ts.isInterfaceDeclaration(d) && !(ts.isVariableDeclaration(d) && !d.initializer && ts.isIdentifier(d.name)));
  const results = decls.map((d) => kindOfDeclaration(d, bindings));
  if (results.length <= 1) return results[0];
  const vitest = results.filter((f) => f?.kind === KIND_FN || f?.kind === KIND_NS);
  if (vitest.length === 0) return undefined;
  const same = vitest.length === results.length && results.every((f) => f.kind === results[0].kind && f.name === results[0].name);
  return same ? results[0] : { kind: KIND_AMBIGUOUS };
}

/** The kind `bindings.resolve()` gives identifier `id` (`KIND_FN`, `KIND_NS`, …), or undefined. */
export function kindOf(id, bindings) {
  return bindings.resolve(id)?.kind;
}
