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

/** Whether `node` is a call or `new` expression. */
export function isCallOrNew(node) {
  return ts.isCallExpression(node) || ts.isNewExpression(node);
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

/** The receiver of a method call (`x` in `x.f(…)`), or undefined for any other call. */
export function receiverOf(call) {
  const callee = ts.isCallExpression(call) ? unwrap(call.expression) : undefined;
  return callee !== undefined && isMemberLink(callee) ? callee.expression : undefined;
}

/** A function's first parameter, past a TypeScript `this` annotation, or undefined. */
export function firstParameter(fn) {
  return fn.parameters.find((p) => !(ts.isIdentifier(p.name) && p.name.text === "this"));
}

/**
 * The expression whose value `node` yields: through wrappers, `await`, a comma operator's last
 * operand (`(0, x)`) and a plain assignment's right side (`rows = x`).
 */
export function resultOf(node) {
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
export function pickBranches(node) {
  if (ts.isConditionalExpression(node)) return [node.whenTrue, node.whenFalse];
  if (isBinaryPick(node)) return [node.left, node.right];
  return [];
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
 * Whether `isLeaf` holds for every value a pick in `node` can produce, each seen through `resultOf`;
 * a node that isn't a pick is its own only value.
 */
export function everyPickLeaf(node, isLeaf) {
  node = resultOf(node);
  const branches = pickBranches(node);
  return branches.length > 0 ? branches.every((b) => everyPickLeaf(b, isLeaf)) : isLeaf(node);
}

/**
 * Whether `node` holds a pick anywhere inside it, outside a nested function, whatever the pick
 * decides (`{ a: url ? 1 : 2 }` holds one). Compare `valueIsPicked` (the value itself is chosen)
 * and `sizeIsPicked` (a table's length is) in `conditions.mjs`.
 */
export function containsPick(node) {
  return someInside(node, isPick);
}

/** Whether `node` is `a && b`, `a || b`, `a ?? b` or one of their assignment forms. */
export function isBinaryPick(node) {
  return ts.isBinaryExpression(node) && PICK_OPERATORS.has(node.operatorToken.kind);
}

/** Whether `test` holds for `node` or anything inside it, outside a nested function. */
function someInside(node, test) {
  if (ts.isFunctionLike(node)) return false;
  if (test(node)) return true;
  return ts.forEachChild(node, (child) => (someInside(child, test) ? true : undefined)) === true;
}

// An options key computed at run time (`{ [expr]: … }`), which could be `skip`.
export const RUNTIME_KEY = Symbol("runtime key");

/** An options key as text, `RUNTIME_KEY` for `[expr]`, or undefined for a name the check skips. */
export function optionKey(name) {
  if (!name) return undefined;
  if (ts.isComputedPropertyName(name)) {
    const expr = unwrap(name.expression);
    return ts.isStringLiteralLike(expr) || ts.isNumericLiteral(expr) ? expr.text : RUNTIME_KEY;
  }
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name) ? name.text : undefined;
}
