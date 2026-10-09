// Whether a suite or test call runs only under a condition, and whether a value is picked at run
// time, for scripts/check-test-gating.mjs.
import {
  invokedBy,
  calleeParts,
  calleeOf,
  holdsPick,
  isBinaryPick,
  isPick,
  isPlainAssignment,
  linkName,
  memberOn,
  optionKey,
  outermostWrapper,
  pickBranches,
  receiverOf,
  ts,
  unwrap,
  resultOf,
} from "./ast.mjs";
import { vitestCallKind } from "./bindings.mjs";

/**
 * Whether `node` (through wrappers and `await`) is picked at run time by `? :`, `&&`, `||` or `??`,
 * or is built from such a pick: by an operator (`+`, `-x`, `typeof`), a template (tagged or not),
 * spread into an array or object, passed to a call or `new`, or the receiver of a method call. A
 * value returned by an inline function (`(() => url ? 0 : 1)()`) is not read: a known limit.
 */
function pickedAtRunTime(node) {
  node = resultOf(node);
  if (isPick(node)) return true;
  if (readsPickedValue(node)) return true;
  // `(url ? 0 : 1) + 1`, `-(url ? 1 : 0)`, `${url ?? ""}`: arithmetic, concatenation or a template
  // over a pick is decided by it too.
  if (ts.isBinaryExpression(node)) return pickedAtRunTime(node.left) || pickedAtRunTime(node.right);
  if (ts.isPrefixUnaryExpression(node)) return pickedAtRunTime(node.operand);
  // `void x` is always `undefined` and `delete x` a boolean the pick doesn't choose, so only `typeof` reads on.
  if (ts.isTypeOfExpression(node)) return pickedAtRunTime(node.expression);
  // `` `${url ?? ""}` ``, `` String.raw`${url ?? ""}` ``: a template's values, tagged or not.
  const template = ts.isTaggedTemplateExpression(node) ? node.template : node;
  if (ts.isTemplateExpression(template)) return template.templateSpans.some((span) => pickedAtRunTime(span.expression));
  // `Object.entries(url ? {…} : {})`, `new Set(url ? [url] : [])`, `(url ? [url] : []).map(f)`: a
  // call or `new` over a pick, or a method of one, yields a table whose size is picked too.
  if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && (node.arguments ?? []).some(pickDecidesSize)) return true;
  if (receiverOf(node) !== undefined && pickDecidesSize(receiverOf(node))) return true;
  // `[url ? "pg" : null, "sqlite"].filter(Boolean)`: a method that can drop elements of a literal
  // array lets a pick in any element decide the size.
  const receiver = receiverOf(node) && resultOf(receiverOf(node));
  if (receiver !== undefined && ts.isArrayLiteralExpression(receiver) && !SIZE_KEEPING.has(calleeParts(node)?.name)) {
    if (receiver.elements.some(holdsPick)) return true;
  }
  // `[a, ...(cond ? [b] : [])]`, `{ a, ...(cond ? { b } : {}) }`: how many rows there are depends on the condition.
  if (ts.isArrayLiteralExpression(node)) return node.elements.some((el) => ts.isSpreadElement(el) && pickedAtRunTime(el.expression));
  return ts.isObjectLiteralExpression(node) && node.properties.some((p) => ts.isSpreadAssignment(p) && pickedAtRunTime(p.expression));
}

/**
 * Whether `node` reads a value a pick decides: `x[k]`, `x.k` or `x.at(k)` where `x` is picked, `k`
 * holds a pick, or `x` is an array or object literal holding one (`[url ? fn : undefined][0]`,
 * `{ f: url ? fn : undefined }.f`, `tables[url ? 0 : 1]`).
 */
export function readsPickedValue(node) {
  let object;
  let key;
  if (ts.isElementAccessExpression(node)) [object, key] = [node.expression, node.argumentExpression];
  else if (ts.isPropertyAccessExpression(node)) object = node.expression;
  else if (receiverOf(node) !== undefined && linkName(unwrap(node.expression)) === "at") [object, key] = [receiverOf(node), node.arguments[0]];
  else return false;
  if (key !== undefined && holdsPick(key)) return true;
  const value = resultOf(object);
  if (ts.isArrayLiteralExpression(value) || ts.isObjectLiteralExpression(value)) return holdsPick(value);
  return pickedAtRunTime(value);
}

/**
 * Whether a call over `node` can yield a table whose size a pick decides: `node` is itself picked,
 * or holds a pick where size comes from (anywhere in a `length`, an element a flattening call can drop:
 * `Array.from({ length: url ? 1 : 0 })`, `[url ? [url] : []].flat()`). A pick of a value inside a
 * fixed-size table (`{ pg: url ?? "postgres://localhost" }`) doesn't change its size.
 */
function pickDecidesSize(node) {
  node = resultOf(node);
  // `f(...[url ? 0 : 1])`: each element spread from an array literal is an argument of its own.
  if (ts.isSpreadElement(node)) {
    const spread = resultOf(node.expression);
    return ts.isArrayLiteralExpression(spread) ? spread.elements.some(pickDecidesSize) : pickDecidesSize(spread);
  }
  if (pickedAtRunTime(node)) return true;
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.some((p) =>
      ts.isPropertyAssignment(p) && optionKey(p.name) === "length" && holdsPick(p.initializer));
  }
  return ts.isArrayLiteralExpression(node) && node.elements.some((el) =>
    pickBranches(resultOf(el)).some((branch) => ts.isArrayLiteralExpression(unwrap(branch))));
}

/** Whether the node `child` of `parent` runs only when a condition holds. */
function conditionalEdge(parent, child) {
  if (ts.isIfStatement(parent)) return child !== parent.expression;
  if (ts.isConditionalExpression(parent)) return child !== parent.condition;
  if (isBinaryPick(parent)) return child === parent.right;
  // A `try` block with a `catch` runs only up to its first throw; the `catch` only after one.
  if (ts.isTryStatement(parent)) return child === parent.tryBlock && parent.catchClause !== undefined;
  // A loop or iteration callback over a table picked by a condition, like a `.each` table.
  if ((ts.isForOfStatement(parent) || ts.isForInStatement(parent)) && child === parent.statement) return pickedAtRunTime(parent.expression);
  // A classic `for`, `while` or `do … while` whose condition (or a `for`'s initializer) holds a pick
  // (`i < (url ? 1 : 0)`) runs its body, or repeats it, only when the pick allows. A condition with no pick (`while (url)`) is a
  // plain loop, a known limit.
  if ((ts.isForStatement(parent) || ts.isWhileStatement(parent) || ts.isDoStatement(parent)) &&
    (child === parent.statement || child === parent.incrementor)) {
    const condition = ts.isForStatement(parent) ? parent.condition : parent.expression;
    // `for (let i = url ? 0 : 1; i < 1; i++)`: the initializer decides the first test of the condition.
    const initializer = ts.isForStatement(parent) ? parent.initializer : undefined;
    return (condition !== undefined && holdsPick(condition)) || (initializer !== undefined && holdsPick(initializer));
  }
  if (receiverOf(parent) !== undefined && parent.arguments.includes(child) && pickedAtRunTime(receiverOf(parent))) return true;
  // `a?.b(arg)`, `a?.[key]`: the arguments and key run only when the chain doesn't short-circuit.
  if (ts.isCallExpression(parent) && ts.isOptionalChain(parent) && parent.arguments.includes(child)) return true;
  if (ts.isElementAccessExpression(parent) && ts.isOptionalChain(parent) && child === parent.argumentExpression) return true;
  // A default value runs only when the value is `undefined`: in a declaration, a parameter, or a
  // destructuring assignment (`[a = x] = …`, `({ a = x } = …)`).
  if ((ts.isBindingElement(parent) || ts.isParameter(parent)) && child === parent.initializer) return true;
  if (ts.isShorthandPropertyAssignment(parent) && child === parent.objectAssignmentInitializer) return true;
  if (isPlainAssignment(parent) && child === parent.right &&
    isAssignmentPatternElement(parent)) {
    return true;
  }
  return ts.isCaseClause(parent) || ts.isDefaultClause(parent) || ts.isCatchClause(parent);
}

/**
 * Whether a suite or test call runs only under a condition, looking outward to the nearest
 * enclosing suite or test call (which is checked on its own), named function, or the file.
 * Plain loops and `forEach`/`map`/`flatMap` callbacks are not conditions; a loop over an iterable
 * a condition picks is one (see `conditionalEdge`), and so is a callback passed to any other call.
 */
export function underCondition(call, bindings) {
  let child = call;
  // Set once the walk leaves a function, until a call it's passed to (directly or inside an
  // argument such as `{ onReady: () => … }`) is reached.
  let inCallback = false;
  let grandchild;
  for (let node = call.parent; node && !ts.isSourceFile(node); grandchild = child, child = node, node = node.parent) {
    if (conditionalEdge(node, child)) return true;
    if (ts.isFunctionDeclaration(node)) return false;
    // A declared class's member that runs later (a method, accessor, constructor or instance field)
    // is a boundary, like a named function; a static block, static field or `extends` clause runs
    // when the class does. A class expression's members run where it is constructed, like a
    // function expression's body, so the walk goes on as for a callback.
    if (ts.isClassLike(node)) {
      // A member's computed key and decorators run with the class, like a static block.
      const viaKeyOrDecorator = grandchild !== undefined && (child.name === grandchild || ts.isDecorator(grandchild));
      if (isDeferredClassMember(child) && !viaKeyOrDecorator) {
        if (ts.isClassDeclaration(node)) return false;
        inCallback = true;
      }
      continue;
    }
    if (calleeOf(node) !== undefined && node !== call && vitestCallKind(node, bindings) !== undefined) {
      return false;
    }
    if (ts.isFunctionLike(node) && !ts.isClassStaticBlockDeclaration(node)) inCallback = true;
    // A callback handed to any other call (`.then`, `setTimeout`, `new Promise`, a helper) may run
    // later or never.
    if (inCallback && ts.isTaggedTemplateExpression(node) && child === node.template) return true;
    // `(async () => { … })().catch(…)`: a throw before the call is swallowed, so it may never run.
    if (inCallback && ts.isCallExpression(node) && unwrap(node.expression) === unwrap(child) && rejectionSwallowed(node)) return true;
    if (inCallback && (ts.isCallExpression(node) || ts.isNewExpression(node)) && node.arguments?.includes(child)) {
      if (!isIterationCall(node)) return true;
      // `rows.values().map(cb).take(url ? 1 : 0)`: an iterator's `map` runs the callback only as far
      // as a later call lets it, so a pick in a call chained after it is a condition.
      if (pickLaterInChain(node)) return true;
      inCallback = false;
    }
  }
  return false;
}

/** Whether `a = x` is an element of a destructuring assignment target, not a plain assignment. */
function isAssignmentPatternElement(binary) {
  let node = binary;
  let p = node.parent;
  if (!(ts.isArrayLiteralExpression(p) || ts.isPropertyAssignment(p))) return false;
  while (ts.isArrayLiteralExpression(p) || ts.isObjectLiteralExpression(p) || ts.isPropertyAssignment(p) || ts.isSpreadElement(p) ||
    ts.isParenthesizedExpression(p)) {
    node = p;
    p = p.parent;
  }
  if (isPlainAssignment(p) && p.left === node) return true;
  return (ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.initializer === node;
}

/** Whether a class member's body runs after the class is defined, not while it is. */
function isDeferredClassMember(member) {
  if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member) || ts.isAccessor(member)) return true;
  if (!ts.isPropertyDeclaration(member)) return false;
  return !(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static);
}

/** Whether a call's result is handed to `.catch(…)` or a two-argument `.then(…)`. */
function rejectionSwallowed(call) {
  const member = memberOn(call);
  if (member === undefined) return false;
  const handler = invokedBy(member);
  if (handler === undefined) return false;
  const name = linkName(member);
  return name === "catch" || (name === "then" && handler.arguments.length >= 2);
}

// Array methods that return as many elements as their receiver has.
const SIZE_KEEPING = new Set(["map", "with", "toSorted", "toReversed", "keys", "values", "entries", "forEach"]);

// Array methods whose callback runs once per element, now: parametrization, like a loop.
const ITERATION_METHODS = new Set(["forEach", "map", "flatMap"]);

/** Whether a method call chained after `call` (`call.take(n)`, `call.slice(…).drop(n)`) holds a pick. */
function pickLaterInChain(call) {
  // `call[url ? "toArray" : "return"]()`: a method chosen by a pick.
  const read = outermostWrapper(call).parent;
  if (ts.isElementAccessExpression(read) && read.expression === outermostWrapper(call) && holdsPick(read.argumentExpression)) return true;
  for (let member = memberOn(call); member !== undefined; ) {
    const next = invokedBy(member);
    if (next === undefined) return false;
    if (next.arguments.some(holdsPick)) return true;
    member = memberOn(next);
  }
  return false;
}

/** Whether `node` is `rows.forEach(cb)`, `rows.map(cb)` or `rows.flatMap(cb)`. */
function isIterationCall(node) {
  const parts = calleeParts(node);
  return parts !== undefined && receiverOf(node) !== undefined && ITERATION_METHODS.has(parts.name);
}

/**
 * Whether a `.each` or `.for` call's arguments let a condition decide how many rows there are: a
 * spread argument, a picked table or value, or, in the template form called directly
 * (`.each(["a|b\n"], …values)`), a pick anywhere in the header strings.
 */
export function rowsPicked(rowArgs) {
  if (rowArgs.some((arg) => ts.isSpreadElement(arg) || pickedAtRunTime(arg))) return true;
  return rowArgs.length > 1 && holdsPick(rowArgs[0]);
}
