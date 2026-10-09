// Globals and the environment, for scripts/check-test-gating.mjs: whether a name is the global it
// spells (`Number`, `Array`, `undefined`), and whether a value reads `process.env`. Separate from
// bindings.mjs, which resolves names to Vitest.
import { importedFrom, isMemberLink, linkName, propertyKey, ts, unwrap } from "./ast.mjs";
import { constHolds } from "./bindings.mjs";

/**
 * Whether identifier `id` names a global (`Number`, `Array`, `process`, `undefined`): the file
 * declares nothing it resolves to. The check's program has no lib, so a built-in has no declaration
 * and a local shadow (`const Array = …`, a parameter named `undefined`) has one.
 */
export function isGlobalName(id, bindings) {
  return ts.isIdentifier(id) && bindings.declarationsOf(id).length === 0;
}

/**
 * Whether `node` reads an environment variable for certain, so it is a plain string or undefined:
 * `process.env.X`, `env.X` (any spelling `isEnvObject` reads), or a name destructured from one into a
 * `const` with no default (`const { X = fn } = process.env` or a `let` could hold a function).
 */
export function isEnvRead(node, bindings) {
  if (ts.isIdentifier(node)) {
    const d = envBinding(node, bindings);
    return d !== undefined && !d.initializer && ts.isVariableDeclarationList(d.parent.parent.parent) &&
      (d.parent.parent.parent.flags & ts.NodeFlags.Const) !== 0;
  }
  return isMemberLink(node) && isEnvObject(node.expression, bindings);
}

/**
 * Whether `node` may hold an environment variable, so the environment can decide it: an env read,
 * or any name destructured from the environment (a default or a `let` included).
 */
export function mayReadEnv(node, bindings) {
  return isEnvRead(node, bindings) || (ts.isIdentifier(node) && envBinding(node, bindings) !== undefined);
}

/** The binding element `id` is declared by when it is destructured from the environment (`const { PG_URL } = process.env`), or undefined. */
function envBinding(id, bindings) {
  const [d, ...rest] = bindings.declarationsOf(id);
  const holder = d?.parent?.parent;
  return d !== undefined && rest.length === 0 && ts.isBindingElement(d) && !d.dotDotDotToken && ts.isObjectBindingPattern(d.parent) &&
    ts.isVariableDeclaration(holder) && holder.initializer !== undefined && isEnvObject(holder.initializer, bindings) ? d : undefined;
}

/**
 * Whether `node` is the environment object: `process.env` or `process["env"]` on any process object
 * (see `isProcessObject`), `import.meta.env` (Vitest mirrors the environment there), `env` imported
 * from `"process"` / `"node:process"` or destructured from a process object (`const { env } = process`),
 * or a `const` bound to one.
 */
function isEnvObject(node, bindings) {
  node = unwrap(node);
  if (ts.isIdentifier(node)) {
    const [d, ...rest] = bindings.declarationsOf(node);
    if (d !== undefined && rest.length === 0 && ts.isImportSpecifier(d) && (d.propertyName ?? d.name).text === "env" &&
      PROCESS_MODULES.has(importedFrom(d))) return true;
    if (d !== undefined && rest.length === 0 && ts.isBindingElement(d) && propertyKey(d.propertyName ?? d.name) === "env" &&
      ts.isObjectBindingPattern(d.parent) && ts.isVariableDeclaration(d.parent.parent) && d.parent.parent.initializer !== undefined &&
      isProcessObject(d.parent.parent.initializer, bindings)) return true;
    return constHolds(node, bindings, (init) => isEnvObject(init, bindings));
  }
  if (!isMemberLink(node) || linkName(node) !== "env") return false;
  const owner = unwrap(node.expression);
  return isProcessObject(owner, bindings) || (ts.isMetaProperty(owner) && owner.keywordToken === ts.SyntaxKind.ImportKeyword);
}

const PROCESS_MODULES = new Set(["process", "node:process"]);

/**
 * Whether `node` is Node's `process`: the global (also as `globalThis.process` or `global.process`),
 * or a default or namespace import of `"process"` / `"node:process"`.
 */
function isProcessObject(node, bindings) {
  node = unwrap(node);
  if (isMemberLink(node) && linkName(node) === "process") {
    const holder = unwrap(node.expression);
    return ts.isIdentifier(holder) && ["globalThis", "global"].includes(holder.text) && isGlobalName(holder, bindings);
  }
  if (!ts.isIdentifier(node)) return false;
  const decls = bindings.declarationsOf(node);
  if (decls.length === 0) return node.text === "process";
  return decls.length === 1 && (ts.isImportClause(decls[0]) || ts.isNamespaceImport(decls[0])) && PROCESS_MODULES.has(importedFrom(decls[0]));
}

/**
 * Whether the plain name `call` is made through is a global: the callee of `Number(…)`, or the
 * object of `Array.from(…)` / `Math.max(…)`, through wrappers. Any other callee isn't.
 */
export function isGlobalCallee(call, bindings) {
  const callee = unwrap(call.expression);
  return isGlobalName(isMemberLink(callee) ? unwrap(callee.expression) : callee, bindings);
}
