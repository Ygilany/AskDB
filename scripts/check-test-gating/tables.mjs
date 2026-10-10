// What a `.each` or `.for` table may be built from, for scripts/check-test-gating.mjs: code that
// reads no environment and reaches only names the check can pin. Nothing else that runs while
// Vitest collects can read the environment either (environment.mjs), so nothing can change such a
// table's rows by it (ADR 0019).
import { bindingHolder, isConstDeclaration, isGlobalName, isImport, isValueReference, readsEnvironment, ts } from "./ast.mjs";

// JavaScript's built-in globals (ECMAScript's, plus `URL`, `TextEncoder` and `TextDecoder`), which a
// table may use undeclared. Any other undeclared name is something the check can't pin.
const BUILT_INS = new Set([
  "AggregateError", "Array", "ArrayBuffer", "Atomics", "BigInt", "BigInt64Array", "BigUint64Array", "Boolean", "DataView",
  "Date", "Error", "EvalError", "Float32Array", "Float64Array", "Infinity", "Int16Array", "Int32Array", "Int8Array",
  "Intl", "JSON", "Map", "Math", "NaN", "Number", "Object", "Promise", "Proxy", "RangeError", "ReferenceError", "Reflect",
  "RegExp", "Set", "String", "Symbol", "SyntaxError", "TextDecoder", "TextEncoder", "TypeError", "URIError", "URL",
  "URLSearchParams", "Uint16Array", "Uint32Array", "Uint8Array", "Uint8ClampedArray", "WeakMap", "WeakRef", "WeakSet",
  "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent", "isFinite", "isNaN", "parseFloat", "parseInt",
  "structuredClone", "undefined",
]);

/**
 * How a `.each` or `.for` table reads, given the `.each` call's arguments: `"gate"` when the table,
 * or code in the file it is built from, reads the environment (see `readsEnvironment`), so the
 * environment could add or drop a row; `"unreadable"` when it is built from a name the check can't
 * pin (a `let`, `var`, parameter or undeclared name other than a built-in); otherwise undefined. A
 * pick on data alone can't depend on the environment. An import is data the check can't see into, a
 * documented limit. The code a table is built from is the table expression, and the initializer of
 * each `const` and the body of each function it names, in turn.
 */
export function tableVerdict(rowArgs, bindings) {
  if (rowArgs.length === 0) return undefined;
  const roots = [...rowArgs];
  const followed = new Set();
  const within = (node) => roots.some((root) => root.pos <= node.pos && node.end <= root.end);
  let unreadable = false;
  for (let i = 0; i < roots.length; i++) {
    const visit = (node) => {
      if (readsEnvironment(node, bindings)) return true;
      if (ts.isIdentifier(node) && isValueReference(node)) {
        // An undeclared name other than a JavaScript built-in is something the check can't pin.
        if (isGlobalName(node, bindings) && !BUILT_INS.has(node.text)) unreadable = true;
        for (const decl of bindings.declarationsOf(node)) {
          if (within(decl) || followed.has(decl) || isImport(decl)) continue;
          const holder = ts.isBindingElement(decl) ? bindingHolder(decl) : decl;
          const source = ts.isFunctionDeclaration(holder) && holder.body !== undefined ? holder
            : isConstDeclaration(holder) ? holder.initializer : undefined;
          if (source === undefined) unreadable = true;
          else {
            followed.add(decl);
            roots.push(source);
          }
        }
      }
      return ts.forEachChild(node, visit);
    };
    if (visit(roots[i])) return "gate";
  }
  return unreadable ? "unreadable" : undefined;
}
