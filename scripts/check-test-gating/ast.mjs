// The TypeScript compiler API and the AST helpers scripts/check-test-gating.mjs builds on.
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Resolve `typescript` from this file's real location, beside the repo's install.
export const ts = createRequire(realpathSync(fileURLToPath(import.meta.url)))("typescript");
if (typeof ts.createSourceFile !== "function" || ts.SyntaxKind === undefined) {
  // TypeScript 7 moved the compiler API out of the package entry point (ADR 0019).
  console.error(
    `check-test-gating: needs the TypeScript 5/6 compiler API; typescript ${ts.version} doesn't export it ` +
      `(see docs/adrs/0019-test-gating-check-parses-with-typescript.md).`,
  );
  process.exit(1);
}

// Wrappers that leave the value unchanged: `(x)`, `x!`, `x as T`, `<T>x`, `x satisfies T`, `x<T>`.
export function isWrapper(node) {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isExpressionWithTypeArguments(node) ||
    ts.isNonNullExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node)
  );
}

/** The outermost wrapper around `node`, or `node` itself. */
export function outermostWrapper(node) {
  while (isWrapper(node.parent) && node.parent.expression === node) node = node.parent;
  return node;
}

/** `node` with its wrappers removed. */
export function unwrap(node) {
  while (isWrapper(node)) node = node.expression;
  return node;
}

/** The callee of a call or the tag of a tagged template, or undefined for any other node. */
export function calleeOf(node) {
  if (ts.isCallExpression(node)) return node.expression;
  if (ts.isTaggedTemplateExpression(node)) return node.tag;
  return undefined;
}

/** Whether `node` is a `.name` or `[key]` member access. */
export function isMemberLink(node) {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
}

/** The property name of a `.name` or `["name"]` link, or undefined. */
export function linkName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return undefined;
}

/** The 1-based line `node` starts on. */
export function lineOf(node) {
  const sf = node.getSourceFile();
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** A one-file program over `sf`: no lib, no module resolution, no emit, no I/O. */
export function oneFileProgram(sf) {
  const host = {
    getSourceFile: (n) => (n === sf.fileName ? sf : undefined),
    fileExists: (n) => n === sf.fileName,
    readFile: () => undefined,
    getDefaultLibFileName: () => "/lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "/",
    getCanonicalFileName: (n) => n,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const options = { noLib: true, noResolve: true, jsx: ts.JsxEmit.Preserve };
  return ts.createProgram([sf.fileName], options, host);
}

/** The `.name` or `[key]` access whose object is `node` (through wrappers), or undefined. */
export function memberOn(node) {
  const outer = outermostWrapper(node);
  const p = outer.parent;
  return isMemberLink(p) && p.expression === outer ? p : undefined;
}

/**
 * A call's callee as `{ owner, name }`: `f(…)` gives `{ name: "f" }`, `o.f(…)` gives `{ owner: "o",
 * name: "f" }` (`owner` only when the receiver is a plain name), through wrappers. Undefined for any
 * other callee.
 */
export function calleeParts(call) {
  if (!ts.isCallExpression(call)) return undefined;
  const callee = unwrap(call.expression);
  if (ts.isIdentifier(callee)) return { name: callee.text };
  if (!isMemberLink(callee)) return undefined;
  const receiver = unwrap(callee.expression);
  return { owner: ts.isIdentifier(receiver) ? receiver.text : undefined, name: linkName(callee) };
}

/** The call whose callee is `node`, through wrappers (`node(…)`, `(node as T)(…)`), or undefined. */
export function invokedBy(node) {
  const outer = outermostWrapper(node);
  const call = outer.parent;
  return ts.isCallExpression(call) && call.expression === outer ? call : undefined;
}

/** Whether `node` is the initializer of a variable declaration (`const x = node`). */
export function isVariableInitializer(node) {
  return ts.isVariableDeclaration(node.parent) && node.parent.initializer === node;
}

/** A function's first parameter, past a TypeScript `this` annotation, or undefined. */
export function firstParameter(fn) {
  return fn.parameters.find((p) => !(ts.isIdentifier(p.name) && p.name.text === "this"));
}

/**
 * The expression whose value `node` yields: through wrappers, `await`, a comma operator's last
 * operand (`(0, x)`) and a plain assignment's right side (`rows = x`).
 */
export function valueExpressionOf(node) {
  for (;;) {
    if (isWrapper(node) || ts.isAwaitExpression(node)) node = node.expression;
    else if (ts.isBinaryExpression(node) && VALUE_OPERATORS.has(node.operatorToken.kind)) node = node.right;
    else return node;
  }
}

// Binary operators whose result is their right operand.
const VALUE_OPERATORS = new Set([ts.SyntaxKind.CommaToken, ts.SyntaxKind.EqualsToken]);

const PICK_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** The operands a run-time choice picks between (`a ? b : c` gives `b`, `c`; `a && b` gives both), or none. */
function pickBranches(node) {
  if (ts.isConditionalExpression(node)) return [node.whenTrue, node.whenFalse];
  if (isBinaryPick(node)) return [node.left, node.right];
  return [];
}

/** Whether `node` is a number, string or boolean literal, a template with no substitutions, or `null`. */
export function isLiteralToken(node) {
  return ts.isNumericLiteral(node) || ts.isStringLiteralLike(node) ||
    [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind);
}

/** Whether object literal member `p` is a plain `key: value` pair with a string key whose value passes `test`. */
export function isKeyedProperty(p, test) {
  return ts.isPropertyAssignment(p) && typeof propertyKey(p.name) === "string" && test(p.initializer);
}

/** Whether `node` is a plain `a = b` assignment. */
export function isPlainAssignment(node) {
  return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken;
}

/** Whether `node` is itself a pick: `? :`, `&&`, `||`, `??` or one of their assignment forms. */
export function isPick(node) {
  return pickBranches(node).length > 0;
}

/**
 * Whether `node` holds a pick (`? :`, `&&`, `||`, `??`) anywhere inside it, outside a nested
 * function (`{ a: url ? 1 : 2 }` holds one).
 */
export function containsPick(node) {
  return someInside(node, isPick);
}

/** Whether `node` is `a && b`, `a || b`, `a ?? b` or one of their assignment forms. */
function isBinaryPick(node) {
  return ts.isBinaryExpression(node) && PICK_OPERATORS.has(node.operatorToken.kind);
}

/**
 * Whether `test` holds for `node` or anything inside it, not looking into a node `stop` holds for
 * (by default a nested function).
 */
export function someInside(node, test, stop = ts.isFunctionLike) {
  if (stop(node)) return false;
  if (test(node)) return true;
  return ts.forEachChild(node, (child) => (someInside(child, test, stop) ? true : undefined)) === true;
}

// A property key computed at run time (`{ [expr]: … }`); as an options key it could be `skip`.
const RUNTIME_KEY = Symbol("runtime key");

/** A property or binding name as text (an options key, a destructured name), `RUNTIME_KEY` for `[expr]`, or undefined for a name the check skips. */
export function propertyKey(name) {
  if (!name) return undefined;
  if (ts.isComputedPropertyName(name)) {
    const expr = unwrap(name.expression);
    return ts.isStringLiteralLike(expr) || ts.isNumericLiteral(expr) ? expr.text : RUNTIME_KEY;
  }
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}

/** The module an import declaration names, through its specifier, clause or binding. */
export function importedFrom(decl) {
  // `import p = require("node:process")`
  if (ts.isImportEqualsDeclaration(decl)) {
    const ref = decl.moduleReference;
    return ts.isExternalModuleReference(ref) && ts.isStringLiteral(ref.expression) ? ref.expression.text : undefined;
  }
  let n = decl;
  while (n && !ts.isImportDeclaration(n)) n = n.parent;
  return n && ts.isStringLiteral(n.moduleSpecifier) ? n.moduleSpecifier.text : undefined;
}

/**
 * The declaration a destructured name belongs to, through nested patterns: the variable
 * declaration or parameter (`const { a: { b } } = x` gives the `const` declaration), or undefined
 * when `element` isn't a binding element.
 */
export function bindingHolder(element) {
  if (element === undefined || !ts.isBindingElement(element)) return undefined;
  let n = element;
  while (ts.isBindingElement(n) || ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) n = n.parent;
  return n;
}

/**
 * The initializer binding element `element` reads a key of directly (`k` in `const { k } = init`),
 * or undefined when it sits in a nested or array pattern, a parameter, or a declaration with no
 * initializer.
 */
export function destructuredFrom(element) {
  const holder = bindingHolder(element);
  return holder !== undefined && ts.isVariableDeclaration(holder) && holder.name === element.parent &&
    ts.isObjectBindingPattern(element.parent) ? holder.initializer : undefined;
}

// Function-protocol links that call the function before them indirectly (`describe.call(…)`,
// `rows.push.apply(rows, […])`, `rows.push.bind(rows)(…)`).
export const INDIRECT_LINKS = new Set(["call", "apply", "bind"]);

/**
 * Whether identifier `id` is a value reference, not a name: a member (`obj.test`), a declared
 * name (variable, parameter, function, property, method, enum member, type parameter, JSX
 * attribute), an import or export name, a label, a JSX tag, or a type.
 */
export function isValueReference(id) {
  const parent = id.parent;
  if (parent.name === id) return ts.isShorthandPropertyAssignment(parent);
  if (parent.propertyName === id || parent.label === id) return false;
  if ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isJsxClosingElement(parent)) && parent.tagName === id) {
    return false;
  }
  // `typeof import("vitest").describe` names a type: the qualifier of an import type.
  return !(ts.isTypeReferenceNode(parent) || ts.isQualifiedName(parent) || ts.isTypeQueryNode(parent) || ts.isImportTypeNode(parent));
}

/**
 * Whether identifier `id` names a global (`Number`, `Array`, `process`, `undefined`): the file
 * declares nothing it resolves to. The check's program has no lib, so a built-in has no declaration
 * and a local shadow (`const Array = …`, a parameter named `undefined`) has one.
 */
export function isGlobalName(id, bindings) {
  return ts.isIdentifier(id) && bindings.declarationsOf(id).length === 0;
}

/** Whether `decl` is a `const` declaration with an initializer (`const x = …`, `const { a } = …`). */
export function isConstDeclaration(decl) {
  return ts.isVariableDeclaration(decl) && decl.initializer !== undefined && ts.isVariableDeclarationList(decl.parent) &&
    (decl.parent.flags & ts.NodeFlags.Const) !== 0;
}

/** Whether `decl` is an import declaration of a name (`import x`, `import { x }`, `import * as x`, `import x = …`). */
export function isImport(decl) {
  return ts.isImportSpecifier(decl) || ts.isImportClause(decl) || ts.isNamespaceImport(decl) || ts.isImportEqualsDeclaration(decl);
}

// How a call's arguments or `.each` table read (`arguments.mjs`, `tables.mjs`): a gate set by hand,
// or a form outside the plain ones.
export const GATE = "gate";
export const UNREADABLE = "unreadable";
