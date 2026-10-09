// Resolves names in a test file to Vitest's describe/suite/it/test and to integrationSuite(), for
// scripts/check-test-gating.mjs.
import { dirname, resolve } from "node:path";
import { calleeOf, isMemberLink, isWrapper, linkName, ts, unwrap } from "./ast.mjs";

const TEST_FNS = new Set(["describe", "suite", "it", "test"]);
// Links whose call returns a new test function: `test.extend({…})`, `test.override({…})`, `test.scoped({…})`.
export const EXTENDERS = new Set(["extend", "override", "scoped"]);

/** The module an import declaration names, through its specifier, clause or binding. */
function importedFrom(decl) {
  let n = decl;
  while (n && !ts.isImportDeclaration(n)) n = n.parent;
  return n && ts.isStringLiteral(n.moduleSpecifier) ? n.moduleSpecifier.text : undefined;
}

/**
 * Resolves names to Vitest's describe/suite/it/test with the binder of a one-file program, so
 * JavaScript scoping decides: an unresolved name is a Vitest global, an import from `vitest` is
 * Vitest, a variable holding `x.extend({…})` of a Vitest function is a test function, and any
 * other declaration (a parameter `it`, an import of `test` from another module) is not Vitest's.
 */
export function vitestBindings(program, isIntegrationModule) {
  const checker = program.getTypeChecker();
  const cache = new Map();
  const bindings = {};
  /**
   * What identifier `id` refers to: `{ kind: "fn", name }` for a Vitest function, `{ kind: "ns" }`
   * for a Vitest namespace, `{ kind: "suiteFactory" }` for `integrationSuite`, `{ kind: "require" }`
   * for a function from `createRequire(…)`, `{ kind: "ambiguous" }` for a name whose declarations
   * disagree about a Vitest value (see `resolveDeclarations`), or undefined.
   */
  bindings.resolve = (id) => {
    const parent = id.parent;
    const symbol = ts.isShorthandPropertyAssignment(parent) && parent.name === id
      ? checker.getShorthandAssignmentValueSymbol(parent)
      : checker.getSymbolAtLocation(id);
    if (symbol === undefined) return TEST_FNS.has(id.text) ? { kind: "fn", name: id.text } : undefined;
    if (cache.has(symbol)) return cache.get(symbol);
    cache.set(symbol, undefined); // a cycle (`const t = t.extend(…)`) resolves to nothing
    const found = resolveDeclarations(symbol, bindings, isIntegrationModule);
    cache.set(symbol, found);
    return found;
  };
  return bindings;
}

/**
 * Whether `node` (through wrappers and `await`) is the Vitest module: `import("vitest")`,
 * `require("vitest")`, or an identifier bound to a Vitest namespace.
 */
function isVitestModule(node, bindings) {
  while (isWrapper(node) || ts.isAwaitExpression(node)) node = node.expression;
  if (ts.isExternalModuleReference(node)) return isVitestSpecifier(node.expression);
  if (ts.isIdentifier(node)) return isVitestNamespace(node, bindings);
  return isVitestLoaderCall(node, bindings);
}

/** Whether `node` is `createRequire(…)` or `module.createRequire(…)`. */
function isCreateRequireCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = unwrap(node.expression);
  return (ts.isIdentifier(callee) && callee.text === "createRequire") || (isMemberLink(callee) && linkName(callee) === "createRequire");
}

/** Whether `node` (through parentheses and casts) is the string `"vitest"`. */
function isVitestSpecifier(node) {
  node = node && unwrap(node);
  return node !== undefined && ts.isStringLiteralLike(node) && node.text === "vitest";
}

/** Whether `node` is `import("vitest")` or `require("vitest")` (a string or plain template). */
export function isVitestLoaderCall(node, bindings) {
  if (!ts.isCallExpression(node) || !isVitestSpecifier(node.arguments[0])) return false;
  const callee = unwrap(node.expression);
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return true; // `import("vitest")`, `import("vitest", opts)`
  // `require`, `module.require`, `globalThis.require`, or a function from `createRequire(…)`.
  if (ts.isIdentifier(callee)) return callee.text === "require" || bindings.resolve(callee)?.kind === "require";
  return isMemberLink(callee) && linkName(callee) === "require";
}

/** Whether identifier `id` names a Vitest namespace. */
export function isVitestNamespace(id, bindings) {
  return bindings.resolve(id)?.kind === "ns";
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
  if (ts.isIdentifier(node)) return bindings.resolve(node)?.kind === "suiteFactory";
  return isMemberLink(node) && linkName(node) === "integrationSuite" && ts.isIdentifier(unwrap(node.expression)) &&
    bindings.resolve(unwrap(node.expression))?.kind === "integrationNs";
}

/** The Vitest function `node` names (`describe`, `v.describe`, a renamed import, an `.extend` alias), or undefined. */
export function testFnName(node, bindings) {
  if (suiteFactoryCall(node, bindings)) return "describe";
  if (ts.isIdentifier(node)) {
    const found = bindings.resolve(node);
    return found?.kind === "fn" ? found.name : undefined;
  }
  // `v.describe`, `require("vitest").describe`, `(await import("vitest")).describe`.
  if (isMemberLink(node) && isVitestModule(node.expression, bindings)) {
    const name = linkName(node);
    return TEST_FNS.has(name) ? name : undefined;
  }
  return undefined;
}

/** The Vitest function an `x.extend(…)` call extends, or undefined for any other node. */
export function extendedFn(node, bindings) {
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
 * What a variable's initializer makes it: a Vitest namespace (`const w = v`, `await import("vitest")`),
 * a `require` (`createRequire(…)`), or a test or suite function (`integrationSuite({…})`,
 * `test.extend({…})`, `require("vitest").describe`).
 */
function resolveInitializer(init, bindings) {
  const fn = testFnName(init, bindings) ?? extendedFn(init, bindings);
  if (fn !== undefined) return { kind: "fn", name: fn };
  if (isVitestModule(init, bindings)) return { kind: "ns" };
  return isCreateRequireCall(init) ? { kind: "require" } : undefined;
}

/**
 * What one declaration makes a name: the `{ kind, … }` record `resolve()` returns, or undefined.
 * A variable's initializer goes through `resolveInitializer`.
 */
function resolveDeclaration(decl, bindings, isIntegrationModule) {
  let found;
  if (decl && ts.isImportSpecifier(decl) && importedFrom(decl) === "vitest") {
    const imported = (decl.propertyName ?? decl.name).text;
    if (TEST_FNS.has(imported)) found = { kind: "fn", name: imported };
  } else if (decl && ts.isNamespaceImport(decl) && importedFrom(decl) === "vitest") {
    found = { kind: "ns" };
  } else if (decl && ts.isImportEqualsDeclaration(decl) && isVitestModule(decl.moduleReference, bindings)) {
    found = { kind: "ns" }; // `import v = require("vitest")`
  } else if (decl && ts.isImportEqualsDeclaration(decl) && ts.isQualifiedName(decl.moduleReference)) {
    // `import d = v.describe`, on a Vitest namespace. A longer name (`v.describe.skip`) fails closed
    // in findGates.
    const { left, right } = decl.moduleReference;
    if (ts.isIdentifier(left) && isVitestNamespace(left, bindings) && TEST_FNS.has(right.text)) found = { kind: "fn", name: right.text };
  } else if (decl && ts.isImportSpecifier(decl) && (decl.propertyName ?? decl.name).text === "integrationSuite" &&
    isIntegrationModule(importedFrom(decl) ?? "")) {
    found = { kind: "suiteFactory" };
  } else if (decl && ts.isNamespaceImport(decl) && isIntegrationModule(importedFrom(decl) ?? "")) {
    found = { kind: "integrationNs" }; // `import * as I from ".../integration.mjs"`
  } else if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
    found = resolveInitializer(unwrap(decl.initializer), bindings);
  } else if (decl && ts.isBindingElement(decl) && ts.isObjectBindingPattern(decl.parent)) {
    // `const { describe } = v`, from a Vitest namespace.
    const holder = decl.parent.parent;
    const init = ts.isVariableDeclaration(holder) && holder.initializer ? unwrap(holder.initializer) : undefined;
    const key = decl.propertyName ?? decl.name;
    if (init && isVitestModule(init, bindings) && ts.isIdentifier(key) && TEST_FNS.has(key.text)) {
      found = { kind: "fn", name: key.text };
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
function resolveDeclarations(symbol, bindings, isIntegrationModule) {
  const decls = (symbol.declarations ?? []).filter((d) =>
    !ts.isTypeAliasDeclaration(d) && !ts.isInterfaceDeclaration(d) && !(ts.isVariableDeclaration(d) && !d.initializer && ts.isIdentifier(d.name)));
  const results = decls.map((d) => resolveDeclaration(d, bindings, isIntegrationModule));
  if (results.length <= 1) return results[0];
  const vitest = results.filter((f) => f?.kind === "fn" || f?.kind === "ns");
  if (vitest.length === 0) return undefined;
  const same = vitest.length === results.length && results.every((f) => f.kind === results[0].kind && f.name === results[0].name);
  return same ? results[0] : { kind: "ambiguous" };
}
