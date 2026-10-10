// What a suite or test call's arguments after the name may be, for scripts/check-test-gating.mjs:
// a few plain shapes only. Anything else fails, rather than the check trying to tell whether it
// could depend on the environment (ADR 0019).
import { containsPick, firstParameter, isGlobalName, propertyKey, resultOf, someInside, ts, unwrap } from "./ast.mjs";
import { constHolds, constInitializer, isInlineFunction } from "./bindings.mjs";
import { readsEnvironment } from "./tables.mjs";

// Options keys that skip a test or invert its result (`fails`, which turns every failure from a
// missing database into a pass): Vitest's options object, a separate vocabulary from the links.
const SKIP_OPTIONS = new Set(["skip", "todo", "fails"]);

/**
 * How a call's arguments after the name read: `"gate"` when they skip it by hand (a skip option
 * that isn't a literal, a literal skip on a suite, or a pick where the body goes), `"unreadable"`
 * when they aren't one of the plain shapes, or undefined. After the name, the plain shapes are
 * nothing, a body, a body and a timeout, options, and options and a body. A body is an inline
 * function (not a `function` that reads `arguments`, where a suite's would reach the test API);
 * options are an object literal of plain `key: value` pairs; a timeout is a plain value.
 */
export function argumentsVerdict(call, suite, bindings) {
  if (!ts.isCallExpression(call)) return undefined;
  if (call.arguments.some(ts.isSpreadElement)) return "unreadable";
  const args = call.arguments.slice(1);
  const [first, second, third] = args.map((arg) => unwrap(arg));
  if (third !== undefined) return "unreadable";
  if (first === undefined) return undefined;
  const body = (node) => isBody(node, suite, bindings);
  const other = (node) => shapeVerdict(node, bindings);
  // `it(name, fn)`, `it(name, fn, 30_000)`: a timeout can't skip the test, so any other value is unreadable, not a gate.
  if (body(first)) return second === undefined || isPlainValue(second, bindings) ? undefined : "unreadable";
  // `it(name, { timeout })`, `it(name, { timeout }, fn)`
  if (ts.isObjectLiteralExpression(first)) {
    return readOptions(first, suite, bindings) ?? (second === undefined || body(second) ? undefined : other(second));
  }
  return other(first);
}

/** `"gate"` for an argument holding a pick or an environment read outside a nested function (`url ? fn : undefined`), else `"unreadable"`. */
function shapeVerdict(node, bindings) {
  return containsPick(node) || someInside(node, (n) => readsEnvironment(n, bindings)) ? "gate" : "unreadable";
}

/**
 * Whether `node` is a body the check reads: an inline function, or a name a `const` binds to one
 * (`const run = () => {…}`; a `function` declaration can be reassigned). A suite's named body takes
 * no parameter (the test API it would get can't be followed through the name), and no `function`
 * body reads `arguments` (where a suite's would reach the test API).
 */
function isBody(node, suite, bindings) {
  if (isInlineFunction(node)) return !readsArguments(node);
  const fn = constInitializer(node, bindings);
  if (fn === undefined || !isInlineFunction(fn)) return false;
  return !readsArguments(fn) && !(suite && firstParameter(fn) !== undefined);
}

/**
 * How an options literal reads: each property a plain `key: value`, with a literal `true` or
 * `false` for `skip`, `todo` and `fails` (`true` only on a test: a suite's is a gate, like
 * `describe.skip`), and a plain value or a literal of plain values anywhere else.
 */
function readOptions(options, suite, bindings) {
  for (const prop of options.properties) {
    // `{ skip }`, `{ get skip() {…} }`: a skip key whose value isn't a literal.
    if (!ts.isPropertyAssignment(prop)) return SKIP_OPTIONS.has(propertyKey(prop.name)) ? "gate" : shapeVerdict(prop, bindings);
    if (typeof propertyKey(prop.name) !== "string") return "unreadable";
    const value = unwrap(prop.initializer);
    if (SKIP_OPTIONS.has(propertyKey(prop.name))) {
      if (value.kind === ts.SyntaxKind.FalseKeyword || (value.kind === ts.SyntaxKind.TrueKeyword && !suite)) continue;
      return "gate";
    }
    if (!isPlainLiteral(value, bindings)) return shapeVerdict(value, bindings);
  }
  return undefined;
}

/** Whether `node` is a plain value, or an array or object literal of them (`{ meta: { owner: "db" } }`). */
function isPlainLiteral(node, bindings) {
  node = unwrap(node);
  if (ts.isArrayLiteralExpression(node)) return node.elements.every((el) => isPlainLiteral(el, bindings));
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every((p) =>
      ts.isPropertyAssignment(p) && typeof propertyKey(p.name) === "string" && isPlainLiteral(p.initializer, bindings));
  }
  return isPlainValue(node, bindings);
}

// Operators whose result is a number when both sides are.
const ARITHMETIC = new Set([
  ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken,
]);

/**
 * Whether `node` is a plain value: a number, string or boolean literal, `null`, the global
 * `undefined`, a template with no substitutions, a sign or arithmetic over plain values, or a
 * `const` bound to one (`5_000`, `60 * 1000`, `const T = 5_000`). No pick, call or other read.
 */
function isPlainValue(node, bindings) {
  node = resultOf(node);
  if (ts.isNumericLiteral(node) || ts.isStringLiteralLike(node)) return true;
  if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return true;
  if (ts.isPrefixUnaryExpression(node)) return isPlainValue(node.operand, bindings);
  if (ts.isBinaryExpression(node) && ARITHMETIC.has(node.operatorToken.kind)) {
    return isPlainValue(node.left, bindings) && isPlainValue(node.right, bindings);
  }
  if (!ts.isIdentifier(node)) return false;
  if (node.text === "undefined" && isGlobalName(node, bindings)) return true;
  return constHolds(node, bindings, (init) => isPlainValue(init, bindings));
}

/** Whether a `function` reads its own `arguments`, where Vitest passes a suite body the test API. */
function readsArguments(fn) {
  if (ts.isArrowFunction(fn)) return false;
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === "arguments") return true;
    if (ts.isFunctionLike(node) && !ts.isArrowFunction(node)) return undefined;
    return ts.forEachChild(node, visit);
  };
  return ts.forEachChild(fn.body, visit) === true;
}
