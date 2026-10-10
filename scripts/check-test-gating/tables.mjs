// What a `.each` or `.for` table may be built from, for scripts/check-test-gating.mjs: code that
// reads no environment and reaches only `const` names and in-file functions that no other
// collection-time statement touches. Anything else fails, rather than the check trying to tell
// which steps could drop a row (ADR 0019).
import { bindingHolder, importedFrom, isMemberLink, isValueReference, linkName, outermostWrapper, ts, unwrap } from "./ast.mjs";
import { definesTests, isVitestHookCall, vitestCallKind } from "./bindings.mjs";

// Names through which code reads the environment: `process.env`, `globalThis.process`, `global.process`.
const ENVIRONMENT_NAMES = new Set(["process", "globalThis", "global"]);
const PROCESS_MODULES = new Set(["process", "node:process"]);
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
 * or code in the file it is built from, reads the environment (`process`, `globalThis`,
 * `import.meta.env`, an import of `"node:process"`), so the environment could add or drop a row;
 * `"unreadable"` when it is built from a name the check can't pin (a `let`, `var` or parameter) or
 * from a `const` or function the file also uses some way other than a read (see `touchedElsewhere`);
 * otherwise undefined. A pick on data alone can't depend on the environment. An import is data the
 * check can't see into, a documented limit. The code a table is built from is the table expression,
 * and the initializer of each `const` and the body of each function it names, in turn.
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
        if (bindings.declarationsOf(node).length === 0 && !BUILT_INS.has(node.text)) unreadable = true;
        for (const decl of bindings.declarationsOf(node)) {
          if (within(decl) || followed.has(decl) || isImport(decl)) continue;
          const holder = ts.isBindingElement(decl) ? bindingHolder(decl) : decl;
          const source = ts.isFunctionDeclaration(holder) && holder.body !== undefined ? holder : isConstDeclaration(holder) ? holder.initializer : undefined;
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
  if (unreadable) return "unreadable";
  // `const all = rows`: an alias is touched like the table.
  const checked = shapeDeclarations(rowArgs, bindings);
  for (const decl of checked) {
    const verdict = touchedElsewhere(decl, within, bindings);
    if (verdict === true) return "unreadable";
    for (const alias of verdict) checked.add(alias);
  }
  return undefined;
  return undefined;
}

/** Whether `node` reads the environment: a `process`, `globalThis` or `global` name, `import.meta.env`, or a name imported from `"node:process"`. */
export function readsEnvironment(node, bindings) {
  // `import.meta.env`, where Vitest mirrors the environment; `import.meta.url` is the file's own path.
  if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) return isMemberLink(node.parent) && linkName(node.parent) === "env";
  if (!ts.isIdentifier(node) || !isValueReference(node)) return false;
  if (ENVIRONMENT_NAMES.has(node.text)) return true;
  return bindings.declarationsOf(node).some((d) => isImport(d) && PROCESS_MODULES.has(importedFrom(d)));
}

function isImport(decl) {
  return ts.isImportSpecifier(decl) || ts.isImportClause(decl) || ts.isNamespaceImport(decl) || ts.isImportEqualsDeclaration(decl);
}

function isConstDeclaration(decl) {
  return ts.isVariableDeclaration(decl) && decl.initializer !== undefined && ts.isVariableDeclarationList(decl.parent) &&
    (decl.parent.flags & ts.NodeFlags.Const) !== 0;
}

/**
 * The `const` declarations that give a table its shape, the rows Vitest gets: the names the table
 * expression reaches through spreads, call receivers and arguments, member reads and the
 * initializers of those names (`rows` in `[...rows]`, `CORPUS` in `CORPUS.filter(f)`, `cfg` in
 * `cfg.engines`), not the values inside its entries (`noRag` in `[["omitted", noRag]]`).
 */
function shapeDeclarations(rowArgs, bindings) {
  const shapes = new Set();
  const visit = (node) => {
    node = unwrap(node);
    if (ts.isIdentifier(node)) {
      for (const decl of bindings.declarationsOf(node)) {
        const holder = ts.isBindingElement(decl) ? bindingHolder(decl) : decl;
        if (shapes.has(decl) || !isConstDeclaration(holder)) continue;
        shapes.add(decl);
        visit(holder.initializer);
      }
    } else if (isMemberLink(node)) {
      visit(node.expression);
    } else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (isMemberLink(unwrap(node.expression))) visit(unwrap(node.expression).expression);
      for (const arg of node.arguments ?? []) if (!ts.isFunctionLike(unwrap(arg))) visit(ts.isSpreadElement(arg) ? arg.expression : arg);
    } else if (ts.isArrayLiteralExpression(node)) {
      for (const el of node.elements) if (ts.isSpreadElement(el)) visit(el.expression);
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) if (ts.isSpreadAssignment(prop)) visit(prop.expression);
    } else if (ts.isSpreadElement(node)) {
      visit(node.expression);
    }
  };
  for (const arg of rowArgs) visit(ts.isSpreadElement(arg) ? arg.expression : arg);
  return shapes;
}

/**
 * Whether the file uses `decl` anywhere but its own declaration, the code a table is built from, a
 * test body or Vitest hook (which run after Vitest has read every table), or a read (see `readSite`):
 * `true`, or else the `const` declarations that alias it or one of its members (`const all = rows`,
 * `const e = cfg.engines`), to check in turn.
 */
function touchedElsewhere(decl, within, bindings) {
  const aliases = [];
  let touched = false;
  const visit = (node) => {
    if (touched) return;
    if (ts.isIdentifier(node) && node.parent !== decl && bindings.declarationsOf(node).includes(decl) &&
      !within(node) && !runsAfterCollection(node, bindings)) {
      const site = readSite(node, bindings);
      if (site === false) touched = true;
      else if (site !== true) aliases.push(site);
    }
    ts.forEachChild(node, visit);
  };
  visit(decl.getSourceFile());
  return touched || aliases;
}

// Methods that read an array, `Map` or `Set` without changing it.
const READ_METHODS = new Set([
  "at", "concat", "entries", "every", "filter", "find", "findIndex", "findLast", "findLastIndex", "flat", "flatMap",
  "forEach", "get", "has", "includes", "indexOf", "join", "keys", "lastIndexOf", "map", "reduce", "reduceRight",
  "slice", "some", "toReversed", "toSorted", "toSpliced", "toString", "values", "with",
]);
// Global functions and constructors that read their argument without changing it.
const READ_FUNCTIONS = new Set([
  "Array.from", "Array.isArray", "Boolean", "JSON.stringify", "Map", "Number", "Object.entries", "Object.keys", "Object.values",
  "Set", "String", "structuredClone",
]);

/**
 * How reference `ref` uses its value: `true` for a read (a property read, a call of a `READ_METHODS`
 * method, an argument to a `READ_FUNCTIONS` global or a Vitest call, a spread, an operand), the
 * `const` declaration it initializes when it is a direct alias (`const all = rows`,
 * `const e = cfg.engines`), or `false` for anything else: a write, `delete`, another method, an
 * argument to another function, or a value stored in another object or array.
 */
function readSite(ref, bindings) {
  let read = ref;
  while (isMemberLink(read.parent) && read.parent.expression === read) read = read.parent;
  const outer = outermostWrapper(read);
  const parent = outer.parent;
  if (isWritten(outer)) return false;
  // `rows.length`, `set.size`: a number, whatever it is then passed to.
  if (read !== ref && ["length", "size"].includes(linkName(read))) return true;
  if (ts.isCallExpression(parent) && parent.expression === outer) {
    return read === ref || (isMemberLink(read) && READ_METHODS.has(linkName(read)));
  }
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.includes(outer)) {
    const name = parent.expression.getText();
    return (READ_FUNCTIONS.has(name) && bindings.declarationsOf(rootName(parent.expression)).length === 0) ||
      (ts.isCallExpression(parent) && vitestCallKind(parent, bindings) !== undefined);
  }
  if (ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent) || ts.isArrayLiteralExpression(parent)) return false;
  if (ts.isVariableDeclaration(parent) && parent.initializer === outer) {
    return isConstDeclaration(parent) && ts.isIdentifier(parent.name) ? parent : false;
  }
  return true;
}

/** The leftmost name of `node` (`Array` in `Array.from`). */
function rootName(node) {
  while (isMemberLink(node)) node = node.expression;
  return node;
}

/**
 * Whether `target` is written: assigned (`=`, `+=`, …), stepped (`++`, `--`), deleted, or the target
 * of a destructuring assignment or a `for…of` / `for…in`.
 */
function isWritten(target) {
  const parent = target.parent;
  if (ts.isDeleteExpression(parent)) return true;
  if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
    [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(parent.operator)) return true;
  let pattern = target;
  while (ts.isArrayLiteralExpression(pattern.parent) || ts.isObjectLiteralExpression(pattern.parent) || ts.isSpreadElement(pattern.parent) ||
    ts.isSpreadAssignment(pattern.parent) || ts.isShorthandPropertyAssignment(pattern.parent) ||
    (ts.isPropertyAssignment(pattern.parent) && pattern.parent.initializer === pattern) || ts.isParenthesizedExpression(pattern.parent)) {
    pattern = pattern.parent;
  }
  const holder = pattern.parent;
  if (ts.isBinaryExpression(holder) && holder.left === pattern &&
    holder.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && holder.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return true;
  return ts.isForInOrOfStatement(holder) && holder.initializer === pattern;
}

/** Whether `node` sits in a test body or a Vitest hook callback, which run after Vitest has read every table. */
function runsAfterCollection(node, bindings) {
  for (let n = node.parent; n !== undefined && !ts.isSourceFile(n); n = n.parent) {
    if (!ts.isFunctionLike(n)) continue;
    const call = outermostWrapper(n).parent;
    if (ts.isCallExpression(call) && call.arguments.includes(outermostWrapper(n)) &&
      (definesTests(call, bindings) || isVitestHookCall(call, bindings))) return true;
  }
  return false;
}
