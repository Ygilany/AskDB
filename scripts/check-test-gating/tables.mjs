// What a `.each` or `.for` table may be built from, for scripts/check-test-gating.mjs: code that
// reads no environment, loads no module, makes no choice where the rows come from, and reaches only
// names the check can pin, which nothing but table code touches while Vitest collects. Anything else fails,
// rather than the check trying to tell which steps could drop a row (ADR 0019).
import {
  bindingHolder, calleeOf, GATE, isConstDeclaration, isGlobalName, isImport, isMemberLink, isPick, isValueReference, linkName,
  outermostWrapper, ts, unwrap, UNREADABLE,
} from "./ast.mjs";
import { isLoaderCall, readsEnvironment, ROW_LINKS, runsAfterCollection, vitestCallKind } from "./bindings.mjs";

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
 * How a `.each` or `.for` table reads, given the `.each` call's arguments: `GATE` when the code it
 * is built from reads the environment (see `readsEnvironment`), or its shape (see `shapeOf`) makes a
 * choice, so a probe or the environment could add or drop a row; `UNREADABLE` when that code loads
 * a module (`await import("better-sqlite3")`, which can fail on one machine), names something
 * the check can't pin (a `let`, `var`, parameter or undeclared name other than a built-in), or
 * reaches a name its shape is built from that other code touches while Vitest collects (see
 * `touchedAtCollection`); otherwise undefined. An import is data the check can't see into, a
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
      if (ts.isCallExpression(node) && isLoaderCall(node, bindings)) unreadable = true;
      if (ts.isIdentifier(node) && isValueReference(node)) {
        // An undeclared name other than a JavaScript built-in is something the check can't pin.
        if (isGlobalName(node, bindings) && !BUILT_INS.has(node.text)) unreadable = true;
        for (const decl of bindings.declarationsOf(node)) {
          if (within(decl) || followed.has(decl) || isImport(decl)) continue;
          const source = codeOf(decl);
          if (source === undefined) unreadable = true;
          else {
            followed.add(decl);
            roots.push(source);
          }
        }
      }
      return ts.forEachChild(node, visit);
    };
    if (visit(roots[i])) return GATE;
  }
  const shape = shapeOf(rowArgs, bindings);
  if (shape.choice) return GATE;
  if (unreadable) return UNREADABLE;
  const tableCode = tableCodeOf(rowArgs[0].getSourceFile(), bindings);
  return [...shape.names].some((decl) => touchedAtCollection(decl, tableCode, bindings)) ? UNREADABLE : undefined;
}

/** The code `decl` binds: a `function`'s declaration, or the initializer of the `const` that declares or destructures it. */
function codeOf(decl) {
  const holder = ts.isBindingElement(decl) ? bindingHolder(decl) : decl;
  if (ts.isFunctionDeclaration(holder) && holder.body !== undefined) return holder;
  return isConstDeclaration(holder) ? holder.initializer : undefined;
}

/**
 * Where a table's rows come from: the table expression, and through each name in it, the `const`
 * or `function` it names, and any function in them that isn't a callback (an IIFE, an object's
 * method or getter), but not a row of an array literal (`["pg", url]`) or a callback
 * (`.filter((e) => …)`), whose code can drop a row only through a name the shape reaches or an
 * imported probe (a documented limit). Returns those code `roots`, the declarations of the `names` they reach, and whether the
 * shape makes a `choice`: a pick (`? :`, `&&`, `||`, `??`), or an `if`, `switch`, loop or `try`.
 */
function shapeOf(rowArgs, bindings) {
  const roots = [];
  const names = new Set();
  let choice = false;
  const follow = (root) => {
    roots.push(root);
    visit(root, true);
  };
  const visit = (node, root = false) => {
    if (!root && ts.isFunctionLike(node) && isCallback(node)) return;
    if (isPick(node) || ts.isIfStatement(node) || ts.isSwitchStatement(node) ||
      ts.isIterationStatement(node, false) || ts.isTryStatement(node)) choice = true;
    if (ts.isArrayLiteralExpression(node)) {
      for (const el of node.elements) if (ts.isSpreadElement(el)) visit(el);
      return;
    }
    if (ts.isIdentifier(node) && isValueReference(node)) {
      for (const decl of bindings.declarationsOf(node)) {
        if (names.has(decl)) continue;
        // An import's code is out of the check's sight, but this file's uses of it are not.
        names.add(decl);
        if (isImport(decl)) continue;
        const source = codeOf(decl);
        if (source !== undefined) follow(source);
      }
    }
    ts.forEachChild(node, (child) => visit(child));
  };
  rowArgs.forEach(follow);
  return { roots, names, choice };
}

/** Whether function `fn` is passed to a call (`.filter((e) => …)`), rather than called in place, held or given to `new`. */
function isCallback(fn) {
  const outer = outermostWrapper(fn);
  return ts.isCallExpression(outer.parent) && outer.parent.arguments.includes(outer);
}

// Each file's table code, by its bindings: the shape roots of every table in it.
const tableCodeCache = new WeakMap();

/** The shape roots (see `shapeOf`) of every `.each` or `.for` table in `sf`. */
function tableCodeOf(sf, bindings) {
  if (tableCodeCache.has(bindings)) return tableCodeCache.get(bindings);
  const roots = [];
  tableCodeCache.set(bindings, roots);
  const visit = (node) => {
    if (ts.isCallExpression(node) && isMemberLink(unwrap(node.expression)) && ROW_LINKS.has(linkName(unwrap(node.expression)))) {
      const outer = outermostWrapper(node);
      if (calleeOf(outer.parent) === outer && vitestCallKind(outer.parent, bindings) !== undefined) {
        roots.push(...shapeOf(node.arguments, bindings).roots);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return roots;
}

/**
 * Whether a name a table's shape reaches is used, while Vitest collects, anywhere but in the code
 * of a table (`tableCode`): `try { await import("pg"); rows.push("pg"); } catch {}` or
 * `register(rows)` could change the rows by what the machine has. A use in a test body or a Vitest
 * hook runs after Vitest has read every table.
 */
function touchedAtCollection(decl, tableCode, bindings) {
  const inTableCode = (node) => tableCode.some((root) => root.pos <= node.pos && node.end <= root.end);
  const touches = (node) => {
    if (ts.isIdentifier(node) && node !== decl.name && isValueReference(node) && bindings.declarationsOf(node).includes(decl) &&
      !inTableCode(node) && !runsAfterCollection(node, bindings)) return true;
    return ts.forEachChild(node, touches) === true;
  };
  return touches(decl.getSourceFile());
}
