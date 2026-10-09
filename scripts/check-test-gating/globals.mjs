// Globals and the environment, for scripts/check-test-gating.mjs: whether a name is the global it
// spells (`Number`, `Array`, `undefined`), and whether a value reads `process.env`. Separate from
// bindings.mjs, which resolves names to Vitest.
import { bindingHolder, destructuredFrom, importedFrom, isMemberLink, linkName, propertyKey, ts, unwrap } from "./ast.mjs";
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
    const list = d !== undefined ? bindingHolder(d).parent : undefined;
    return d !== undefined && !d.initializer && ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
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
  const init = d !== undefined && rest.length === 0 && !d.dotDotDotToken ? destructuredFrom(d) : undefined;
  return init !== undefined && isEnvObject(init, bindings) ? d : undefined;
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
    const init = d !== undefined && rest.length === 0 ? destructuredFrom(d) : undefined;
    if (init !== undefined && propertyKey(d.propertyName ?? d.name) === "env" && isProcessObject(init, bindings)) return true;
    return constHolds(node, bindings, (init) => isEnvObject(init, bindings));
  }
  if (!isMemberLink(node) || linkName(node) !== "env") return false;
  const owner = unwrap(node.expression);
  return isProcessObject(owner, bindings) || (ts.isMetaProperty(owner) && owner.keywordToken === ts.SyntaxKind.ImportKeyword);
}

const PROCESS_MODULES = new Set(["process", "node:process"]);

/**
 * Whether `node` is Node's `process`: the global (also as `globalThis.process`, `global.process` or
 * `const { process } = globalThis`), a default or namespace import of `"process"` / `"node:process"`,
 * or a `const` bound to one.
 */
function isProcessObject(node, bindings) {
  node = unwrap(node);
  if (isMemberLink(node) && linkName(node) === "process") {
    const holder = unwrap(node.expression);
    return ts.isIdentifier(holder) && ["globalThis", "global"].includes(holder.text) && isGlobalName(holder, bindings);
  }
  if (!ts.isIdentifier(node)) return false;
  const [d, ...rest] = bindings.declarationsOf(node);
  if (d === undefined) return node.text === "process";
  if (rest.length > 0) return false;
  if ((ts.isImportClause(d) || ts.isNamespaceImport(d)) && PROCESS_MODULES.has(importedFrom(d))) return true;
  // `const { process: p } = globalThis`
  const init = destructuredFrom(d);
  if (init !== undefined && propertyKey(d.propertyName ?? d.name) === "process") {
    const holder = unwrap(init);
    return ts.isIdentifier(holder) && ["globalThis", "global"].includes(holder.text) && isGlobalName(holder, bindings);
  }
  // `const p = process`
  return constHolds(node, bindings, (value) => isProcessObject(value, bindings));
}

/**
 * Whether the plain name `call` is made through is a global: the callee of `Number(…)`, or the
 * object of `Array.from(…)` / `Math.max(…)`, through wrappers. Any other callee isn't.
 */
export function isGlobalCallee(call, bindings) {
  const callee = unwrap(call.expression);
  return isGlobalName(isMemberLink(callee) ? unwrap(callee.expression) : callee, bindings);
}
