// What a suite or test call's arguments after the name do: skip or invert through options, pick
// or build the body at run time, or pass options the check can't read. For
// scripts/check-test-gating.mjs.
import { holdsPick, isPick, optionKey, outermostWrapper, pickBranches, receiverOf, resultOf, RUNTIME_KEY, ts, unwrap } from "./ast.mjs";
import { isNumericConversion, isTimeoutValue } from "./bindings.mjs";
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
    if (i === body && bodyBuiltFromPick(resultOf(arg))) return true;
    visit(arg, false);
    // `[{ skip: cond }][0]`, `Object.assign({}, { skip: cond })`: options literals inside the
    // argument, outside a nested function (the body).
    if (i > 0) visitNested(arg, false, resultOf(arg));
  }
  return gate;
}

/**
 * The index of the argument that can only be the body: the second, when no third follows or the
 * third is a timeout. Undefined when two arguments follow the name (`it(name, a, b)`): either may
 * be options, so both are read as options, and an inline function among them is never built.
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
  return [1, 2].some((i) => i !== body && call.arguments[i] !== undefined && builtByCall(resultOf(call.arguments[i])));
}

/** Whether `node` is built by a call: a call, `new` or tagged template, other than a numeric conversion. */
function builtByCall(node) {
  const built = ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isTaggedTemplateExpression(node);
  return built && !(ts.isCallExpression(node) && isNumericConversion(node));
}

/**
 * Whether a body built by a call (`withDb(…)`, `Reflect.get(…)`) is chosen at run time: any pick
 * inside the call, its receiver or template. The call can read a pick as anything (an index, an
 * argument list, an option it passes on), so even a pick between literals fails closed
 * (`withDb(url ?? ":memory:", fn)`, `Reflect.get([fn, undefined], url ? 0 : 1)`).
 */
function bodyBuiltFromPick(node) {
  if (!builtByCall(node)) return false;
  const parts = ts.isTaggedTemplateExpression(node) ? [node.tag, node.template] : [...(node.arguments ?? []), receiverOf(node)];
  return parts.some((part) => part !== undefined && holdsPick(part));
}
