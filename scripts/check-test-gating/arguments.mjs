// What a suite or test call's arguments after the name do: skip or invert through options, pick
// or build the body at run time, or pass options the check can't read. For
// scripts/check-test-gating.mjs.
import { calleeParts, everyPickLeaf, firstParameter, holdsPick, isPick, optionKey, pickBranches, receiverOf, resultOf, RUNTIME_KEY, ts, unwrap } from "./ast.mjs";
import { CALL_SUITE, constInitializer, isInlineFunction, vitestCallKind } from "./bindings.mjs";
import { readsPickedValue } from "./conditions.mjs";

// Options keys that skip a test or invert its result (`fails`, which turns every failure from a
// missing database into a pass): Vitest's options object, a separate vocabulary from the links.
const SKIP_OPTIONS = new Set(["skip", "todo", "fails"]);

/**
 * Whether a suite or test call's arguments after the name gate it: options that skip or invert
 * (`{ skip: cond }`, `{ todo: cond }`, `{ fails: cond }`, options picked by `? :`, `&&`, `||` or
 * `??`), a body or options picked or built at run time, or a spread. A literal `true` on a test is
 * a plain skipped or expected-to-fail test, like `it.skip`; on a suite, a literal `true` for
 * `skip`, `todo` or `fails` is a gate, like `describe.skip`.
 */
export function argumentsGate(call, suite, bindings) {
  if (!ts.isCallExpression(call)) return false;
  let gate = false;
  const visit = (node, chosen) => {
    node = resultOf(node);
    const branches = pickBranches(node);
    if (branches.length > 0) {
      for (const branch of branches) visit(branch, true);
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        // A spread or a key computed at run time could carry `skip`; fail closed.
        if (ts.isSpreadAssignment(prop)) { gate = true; continue; }
        const key = optionKey(prop.name);
        if (key === RUNTIME_KEY) { gate = true; continue; }
        if (!SKIP_OPTIONS.has(key)) continue;
        if (!ts.isPropertyAssignment(prop)) { gate = true; continue; } // shorthand, getter, method
        const value = unwrap(prop.initializer);
        const literal = value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword;
        if (chosen || !literal || (suite && value.kind === ts.SyntaxKind.TrueKeyword)) gate = true;
      }
    }
  };
  // A literal under a pick's branch (`Object.assign({}, url ? {} : { skip: true })`) is chosen.
  const visitNested = (node, chosen, options) => {
    if (ts.isFunctionLike(node)) return;
    // `{ meta: { todo: "#123" } }`: Vitest reads a task's mode from the options' own keys, never
    // from their `meta`. A `meta` anywhere else (`{ meta: { todo: c } }.meta`) is read like any value.
    if (ts.isPropertyAssignment(node) && node.parent === options && optionKey(node.name) === "meta") return;
    const branches = pickBranches(node);
    ts.forEachChild(node, (child) => {
      const childChosen = chosen || branches.includes(child);
      if (ts.isObjectLiteralExpression(child)) visit(child, childChosen);
      visitNested(child, childChosen, options);
    });
  };
  const body = bodyIndex(call, bindings);
  for (const [i, arg] of call.arguments.entries()) {
    // `describe(...args)`: the options could be in there, unread; fail closed.
    if (ts.isSpreadElement(arg)) return true;
    // `it(name, url ? fn : undefined)`: a body picked at run time can be missing, which makes the
    // test a todo. Only a pick between plain strings or numbers (a timeout) is left alone, and a
    // value computed from a pick (`Number(env ?? 60_000)`) is always there.
    if (i > 0 && isPick(resultOf(arg)) && !isTimeoutValue(arg, bindings)) return true;
    // `it(name, [{}, { skip: true }][url ? 0 : 1], fn)`, `[url ? fn : undefined][0]`: options or a
    // body read out of a pick.
    if (i > 0 && readsPickedValue(resultOf(arg))) return true;
    // A body built by a call over a pick (see `bodyBuiltFromPick`). Options built by a call are
    // `optionsUnreadable`.
    if (i === body && bodyBuiltFromPick(resultOf(arg), bindings)) return true;
    visit(arg, false);
    // `[{ skip: cond }][0]`, `Object.assign({}, { skip: cond })`: options literals inside the
    // argument, outside a nested function (the body).
    if (i > 0) visitNested(arg, false, resultOf(arg));
  }
  return gate;
}

/**
 * The index of the argument Vitest runs as the body: the second when no third follows or the third
 * is a timeout, otherwise the third (`it(name, options, body)`), since Vitest takes only a body or a
 * number there.
 */
function bodyIndex(call, bindings) {
  const [, , third] = call.arguments;
  return third === undefined || isTimeoutValue(third, bindings) ? 1 : 2;
}

/**
 * Whether a suite or test call passes options or a timeout the check can't read: a call, `new` or
 * tagged template (other than a numeric conversion) in an argument after the name that isn't the
 * body (`it(name, Object.fromEntries([[key, !url]]), fn)`, `it(name, fn, timeoutFor(env))`).
 */
export function optionsUnreadable(call, bindings) {
  if (!ts.isCallExpression(call)) return false;
  const body = bodyIndex(call, bindings);
  return [1, 2].some((i) => i !== body && call.arguments[i] !== undefined && builtByCall(resultOf(call.arguments[i]), bindings));
}

/**
 * Whether `node` is built by a call: a call, `new` or tagged template, other than a numeric
 * conversion that can only produce a number (see `isNumberCall`).
 */
function builtByCall(node, bindings) {
  return isCallLike(node) && !isNumberCall(node, bindings);
}

function isCallLike(node) {
  return ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node);
}

/**
 * Whether `call` is a numeric conversion none of whose arguments can be a function or `undefined`
 * (`Number(env ?? 60_000)`), so it yields a number however `Number` is bound. With a function among
 * them (`Number(url ? fn : undefined)` after `globalThis.Number = (x) => x`) it can yield the body.
 */
function isNumberCall(call, bindings) {
  if (!ts.isCallExpression(call) || !isNumericConversion(call, bindings)) return false;
  return call.arguments.every((arg) => everyPickLeaf(arg, (leaf) => {
    leaf = unwrap(leaf);
    if (isInlineFunction(leaf)) return false;
    return !ts.isIdentifier(leaf) || (leaf.text !== "undefined" && constFunction(leaf, bindings) === undefined);
  }));
}

/**
 * Whether a body built by a call (`withDb(…)`, `Reflect.get(…)`) is chosen at run time: any pick
 * inside the call, its receiver or template. The call can read a pick as anything (an index, an
 * argument list, an option it passes on), so even a pick between literals fails closed
 * (`withDb(url ?? ":memory:", fn)`, `Reflect.get([fn, undefined], url ? 0 : 1)`).
 */
function bodyBuiltFromPick(node, bindings) {
  // A numeric conversion is never a real body, so it gets no exemption here.
  if (!isCallLike(node)) return false;
  const parts = ts.isTaggedTemplateExpression(node) ? [node.tag, node.template] : [...(node.arguments ?? []), receiverOf(node)];
  return parts.some((part) => part !== undefined && holdsPick(part));
}

/**
 * Whether a suite call passes a body the check can't read for the test API Vitest passes it.
 * Vitest runs the second argument when it is a function, and otherwise the third, so when the
 * second isn't known to be a function both are judged: each must be a body the check reads or a
 * value that can't be a function (options, a timeout). A body is read when it is an inline
 * function (see `isSuiteBody`), a pick (which the gate rules report), or a `const` bound to a
 * function with no parameter. Anything else fails closed: `describe("db", body)` with
 * `function body(test) {…}` or a `let`, a global, `suites.db`, `makeBody()`, `body.bind(null)`,
 * `(0, body)`, `body = …`, `await body`, and a `function` body that reads the API through
 * `arguments`. A `.each` or `.for` body receives a row, not the test API.
 */
export function suiteBodyUnreadable(call, bindings) {
  if (!ts.isCallExpression(call) || vitestCallKind(call, bindings) !== CALL_SUITE) return false;
  if (call.arguments.some(ts.isSpreadElement)) return false; // reported as a spread argument list
  const [, second, third] = call.arguments.map((arg) => unwrap(arg));
  if (second === undefined) return false;
  // A function second argument is the body, and Vitest rejects a function after it.
  if (isInlineFunction(second) || constFunction(second, bindings) !== undefined) return !isReadableSuiteBody(second, bindings);
  return [second, third].some((arg) => arg !== undefined && !isReadableSuiteBody(arg, bindings) && !isNonFunction(arg, bindings));
}

function isReadableSuiteBody(body, bindings) {
  if (isInlineFunction(body)) return !readsArguments(body);
  if (isPick(body)) return true;
  const fn = constFunction(body, bindings);
  return fn !== undefined && firstParameter(fn) === undefined && !readsArguments(fn);
}

/** The inline function a `const` name is bound to (`const body = () => {…}`), or undefined. */
function constFunction(node, bindings) {
  const init = ts.isIdentifier(node) ? constInitializer(node, bindings) : undefined;
  return init !== undefined && isInlineFunction(init) ? init : undefined;
}

// Calls that turn a value into a number: a timeout computed from a pick, not options or a body.
const NUMERIC_CONVERSIONS = new Set(["Number", "parseInt", "parseFloat"]);
// `Math` methods that return a number (not `Math.constructor`, which is `Object`).
const MATH_NUMBERS = new Set(["abs", "ceil", "floor", "max", "min", "pow", "round", "trunc"]);

/** Whether `call` is the global `Number(…)`, `parseInt(…)`, `parseFloat(…)`, `Number.parseInt(…)` or a numeric `Math` method. */
function isNumericConversion(call, bindings) {
  const parts = calleeParts(call);
  if (parts === undefined) return false;
  // `const Number = (x) => x`: a name declared in the file is not the global.
  const callee = unwrap(call.expression);
  const name = ts.isIdentifier(callee) ? callee : unwrap(callee.expression);
  if (ts.isIdentifier(name) && bindings.declarationsOf(name).length > 0) return false;
  if (parts.owner === undefined) return receiverOf(call) === undefined && NUMERIC_CONVERSIONS.has(parts.name);
  return (parts.owner === "Math" && MATH_NUMBERS.has(parts.name)) || (parts.owner === "Number" && NUMERIC_CONVERSIONS.has(parts.name));
}

// Operators whose result is a number when both sides are.
const ARITHMETIC = new Set([
  ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken, ts.SyntaxKind.AsteriskAsteriskToken,
]);

/**
 * Whether `node` is a timeout: a number literal, arithmetic over numbers, a numeric conversion, a
 * `const` bound to one, or a pick between such values or plain strings (`5_000`, `60 * 1000`,
 * `const T = 5_000`, `Number(env ?? 60_000)`, `url ? 10_000 : 5_000`).
 */
function isTimeoutValue(node, bindings) {
  return everyPickLeaf(node, (leaf) => {
    if (ts.isNumericLiteral(leaf) || ts.isStringLiteralLike(leaf)) return true;
    if (ts.isPrefixUnaryExpression(leaf)) return isTimeoutValue(leaf.operand, bindings);
    if (ts.isBinaryExpression(leaf) && ARITHMETIC.has(leaf.operatorToken.kind)) {
      return isTimeoutValue(leaf.left, bindings) && isTimeoutValue(leaf.right, bindings);
    }
    if (ts.isCallExpression(leaf)) return isNumberCall(leaf, bindings);
    const init = ts.isIdentifier(leaf) ? constInitializer(leaf, bindings) : undefined;
    return init !== undefined && isTimeoutValue(init, bindings);
  });
}

/**
 * Whether `node` can't be a function, in the forms a suite passes before its body: options or a
 * timeout (`{ timeout }`, `5_000`, `-1`), `undefined` or `null`, a pick between such values, or a
 * `const` bound to one.
 */
function isNonFunction(node, bindings) {
  return everyPickLeaf(node, (leaf) => {
    if (ts.isObjectLiteralExpression(leaf) || leaf.kind === ts.SyntaxKind.NullKeyword) return true;
    if (!ts.isStringLiteralLike(leaf) && isTimeoutValue(leaf, bindings)) return true;
    if (!ts.isIdentifier(leaf)) return false;
    if (leaf.text === "undefined" && bindings.declarationsOf(leaf).length === 0) return true;
    const init = constInitializer(leaf, bindings);
    return init !== undefined && isNonFunction(init, bindings);
  });
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
