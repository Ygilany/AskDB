// Where a suite or test may be defined, for scripts/check-test-gating.mjs: straight-line code only.
// A definition the check can't show always runs (under a condition, in a loop, a callback or a
// helper, or after a statement that can leave the block first) fails, rather than the check trying
// to tell which conditions could depend on the environment (ADR 0019).
import { isMemberLink, isPlainAssignment, isVariableInitializer, isWrapper, outermostWrapper, someInside, ts } from "./ast.mjs";
import { vitestCallKind } from "./bindings.mjs";

/**
 * Whether suite or test call `call` is defined anywhere but straight-line code. Walking out to the
 * Vitest body it sits in (an inline function passed to a suite, test or `.each` call) or to the
 * file, only an expression statement, a block, `await`, wrappers and the nodes that keep a result
 * (see `keepsResult`, which `resultUsed` reports instead) may stand between, and no earlier
 * statement in a block on the way may `return`. (A `break` or `continue` that could leave the block
 * targets a loop, `switch` or label around it, which already fails.)
 */
export function definedOffPlainPath(call, bindings) {
  let child = outermostWrapper(call);
  for (let node = child.parent; node !== undefined; child = node, node = node.parent) {
    if (ts.isExpressionStatement(node) || ts.isAwaitExpression(node) || isWrapper(node) || keepsResult(node, child)) continue;
    if (ts.isBlock(node) || ts.isModuleBlock(node) || ts.isSourceFile(node)) {
      if (exitsEarlier(node.statements, child)) return true;
      if (ts.isSourceFile(node)) return false;
      continue;
    }
    if (ts.isFunctionLike(node)) return !isVitestBody(node, bindings);
    return true;
  }
  return false;
}

/**
 * Whether the value of suite or test call `call` is kept or read (`const c = describe(…)`,
 * `describe(…).test`, `registry = describe(…)`, `register(describe(…))`): the collector it returns
 * carries a test API the check can't follow.
 */
export function resultUsed(call) {
  let outer = outermostWrapper(call);
  while (ts.isAwaitExpression(outer.parent) || isWrapper(outer.parent)) outer = outer.parent;
  const p = outer.parent;
  return (isMemberLink(p) && p.expression === outer) || isVariableInitializer(outer) || (isPlainAssignment(p) && p.right === outer) ||
    ((ts.isCallExpression(p) || ts.isNewExpression(p)) && (p.arguments ?? []).includes(outer));
}

/**
 * Whether `node` only keeps or reads the value of its child `child`, unconditionally: a `const` or
 * `let` declaration (`const c = describe(…)`), a plain assignment, a member read or a call on it
 * (`describe(…).test.skip(…)`), or a non-optional call it is passed to (`register(describe(…))`).
 */
function keepsResult(node, child) {
  if ((ts.isVariableDeclaration(node) && node.initializer === child) || ts.isVariableDeclarationList(node) || ts.isVariableStatement(node)) return true;
  if (isPlainAssignment(node) && node.right === child) return true;
  if (isMemberLink(node) && node.expression === child && !ts.isOptionalChain(node)) return true;
  return ts.isCallExpression(node) && !ts.isOptionalChain(node) && (node.expression === child || node.arguments.includes(child));
}

/** Whether function `fn` is a body passed straight to a Vitest suite, test or `.each` call. */
function isVitestBody(fn, bindings) {
  const outer = outermostWrapper(fn);
  const call = outer.parent;
  return ts.isCallExpression(call) && call.arguments.includes(outer) && vitestCallKind(call, bindings) !== undefined;
}

/** Whether a statement before `child` in `statements` can `return`, outside a nested function or class. */
function exitsEarlier(statements, child) {
  const index = statements.indexOf(child);
  return index > 0 && statements.slice(0, index).some((statement) =>
    someInside(statement, ts.isReturnStatement, (node) => ts.isFunctionLike(node) || ts.isClassLike(node)));
}
