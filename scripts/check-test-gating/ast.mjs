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

// Wrappers that leave the value unchanged: `(x)`, `x!`, `x as T`, `<T>x`, `x satisfies T`.
export function isWrapper(node) {
  return (
    ts.isParenthesizedExpression(node) ||
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

/** A function's first parameter, past a TypeScript `this` annotation, or undefined. */
export function firstParameter(fn) {
  return fn.parameters.find((p) => !(ts.isIdentifier(p.name) && p.name.text === "this"));
}

/** `node` with its wrappers and any `await` removed. */
export function unwrapValue(node) {
  while (isWrapper(node) || ts.isAwaitExpression(node)) node = node.expression;
  return node;
}

/** Whether `test` holds for `node` or anything inside it, outside a nested function. */
export function someInside(node, test) {
  if (ts.isFunctionLike(node)) return false;
  if (test(node)) return true;
  return ts.forEachChild(node, (child) => (someInside(child, test) ? true : undefined)) === true;
}
