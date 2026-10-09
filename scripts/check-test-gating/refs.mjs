// The reference walk of check-test-gating: finds each use of Vitest's describe/suite/it/test, or of
// the sanctioned gate, in one parsed file and records what `RULES` (in the entry script) needs to
// judge it. Also reads the `check-test-gating-ignore-next-line` pragmas.
import { calleeOf, invokedBy, isMemberLink, isPlainAssignment, isVariableInitializer, isWrapper, lineOf, linkName, memberOn, outermostWrapper, ts, unwrap } from "./ast.mjs";
import {
  EXTENDERS,
  MODIFIERS,
  ROW_LINKS,
  definesSuite,
  isDetachedLoader,
  isUnreadableViUse,
  isPromiseLoader,
  isSuiteFactory,
  isVitestModuleUse,
  kindOf,
  KIND_AMBIGUOUS,
  KIND_FN,
  KIND_INTEGRATION_NS,
  KIND_SUITE_FACTORY,
  testFnName,
} from "./bindings.mjs";
import { rowsPicked, underCondition } from "./conditions.mjs";
import { argumentsGate, optionsUnreadable, suiteBodyUnreadable } from "./arguments.mjs";

const PRAGMA = /^\/\/\s*check-test-gating-ignore-next-line\s*:\s*\S/;

/**
 * Whether a Vitest namespace identifier is used in a form the check reads: `v.member`,
 * `v["member"]`, or `const w = v` / `const { describe } = v` (both resolved as aliases). A computed
 * key, a rest element or a nested pattern fails closed.
 */
function isReadableNamespaceUse(id) {
  let outer = outermostWrapper(id);
  // A loader is read through `await`: `(await import("vitest")).describe`. An `import()` or
  // `vi.importActual()` that isn't awaited is a promise (`.then(…)`, stored, passed on), which the
  // check can't follow.
  if (ts.isCallExpression(id)) {
    if (!ts.isAwaitExpression(outer.parent) && isPromiseLoader(unwrap(id.expression))) return false;
    while (ts.isAwaitExpression(outer.parent) || isWrapper(outer.parent)) outer = outer.parent;
  }
  const member = memberOn(outer);
  if (member !== undefined) return linkName(member) !== undefined;
  const p = outer.parent;
  if (!isVariableInitializer(outer)) return false;
  if (ts.isIdentifier(p.name)) return true;
  // `const { describe, it: t } = v`: plain keys only, no rest, computed key or nesting.
  return ts.isObjectBindingPattern(p.name) && p.name.elements.every((el) =>
    !el.dotDotDotToken && ts.isIdentifier(el.name) && (!el.propertyName || ts.isIdentifier(el.propertyName)));
}

/** A ref with nothing to report, for `testRef` and `unreadableRef` to fill in. */
function emptyRef(start) {
  return {
    suite: false, links: [], runtimeModifier: false, chain: start, invoked: false, unreadable: false,
    conditional: false, runtimeGate: false, line: lineOf(start),
  };
}

/**
 * A use the check can't follow: a Vitest namespace or loader passed on (`fn(v)`, `import("vitest")
 * .then(…)`), `integrationSuite` or its module aliased, or `import d = v.x`. It fails closed.
 */
function unreadableRef(id) {
  return { ...emptyRef(id), unreadable: true };
}

/**
 * Whether identifier `id` is a value reference, not a name: a member (`obj.test`), a declared
 * name (variable, parameter, function, property, method, enum member, type parameter, JSX
 * attribute), an import or export name, a label, a JSX tag, or a type.
 */
function isValueReference(id) {
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
 * A reference to Vitest's describe/suite/it/test, starting at the identifier or `v.describe`
 * node `start`: its `.modifier` links, the outermost expression of the member chain (`chain`), the
 * call or tagged template that invokes it, and what the rules need to know about that call.
 * `it.skip.each(rows)(name, fn)` counts as invoked, through the call `each(rows)` returns.
 */
function testRef(start, fnName, bindings) {
  const links = [];
  let runtimeModifier = false;
  let extendCallPending = false;
  let chain = start;
  for (;;) {
    const inner = outermostWrapper(chain);
    const up = inner.parent;
    // `test.extend({…})` returns a test function: read the chain on through that one call.
    if (extendCallPending && calleeOf(up) === inner) {
      extendCallPending = false;
      chain = up;
      continue;
    }
    if (!isMemberLink(up) || up.expression !== inner) break;
    const name = linkName(up);
    if (name === undefined) {
      // `describe[expr]`: a modifier chosen at run time can't be classified, so it fails closed.
      runtimeModifier = true;
      chain = up;
      break;
    }
    links.push(name);
    extendCallPending = EXTENDERS.has(name);
    chain = up;
  }
  chain = outermostWrapper(chain);
  let call;
  let rowArgs = [];
  let eachResultStored = false;
  const p = chain.parent;
  if (calleeOf(p) === chain) {
    call = p;
    // `.each(rows)` / `.for(rows)` returns the function that defines the tests.
    const last = links[links.length - 1];
    const outer = invokedBy(call);
    if (ROW_LINKS.has(last) && outer !== undefined) {
      // The table, or with the template form called directly (`.each(strings, ...values)`), every value.
      rowArgs = ts.isCallExpression(call) ? [...call.arguments] : [];
      call = outer;
    } else if (ROW_LINKS.has(last)) {
      eachResultStored = true;
    }
  }
  const lastExtender = links.findLastIndex((l) => EXTENDERS.has(l));
  const ownLinks = links.slice(lastExtender + 1);
  // `it.describe(…)` defines a suite, like `describe(…)`.
  const suite = definesSuite(fnName, ownLinks);
  // Links after the last `.extend`; a call through Vitest modifiers only defines a suite or test.
  const defines = call !== undefined && !extendCallPending && ownLinks.every((l) => MODIFIERS.has(l));
  return {
    ...emptyRef(start),
    suite,
    links,
    runtimeModifier,
    chain,
    invoked: call !== undefined,
    // `const t = it.each(rows)` stores the function that defines the tests, which the check can't follow.
    unreadable: (call === undefined && !extendResultIsTracked(chain)) || eachResultStored ||
      (suite && defines && (suiteResultHeld(call) || suiteBodyUnreadable(call, bindings))) || (defines && optionsUnreadable(call, bindings)),
    conditional: defines && underCondition(call, bindings),
    runtimeGate: defines && (argumentsGate(call, suite, bindings) || rowsPicked(rowArgs, bindings)),
  };
}

/**
 * Whether a suite call's result is kept or read (`const c = describe(…)`, `describe(…).test`): the
 * collector it returns carries a test API the check can't follow.
 */
function suiteResultHeld(call) {
  const outer = outermostWrapper(call);
  const p = outer.parent;
  return memberOn(outer) !== undefined || isVariableInitializer(outer) ||
    (isPlainAssignment(p) && p.right === outer);
}

/**
 * Whether a `test.extend({…})` or `integrationSuite({…})` result is one the check can still
 * follow: assigned to a variable (resolved as a test or suite function, see `vitestBindings`) or
 * discarded.
 */
function extendResultIsTracked(chain) {
  // `integrationSuite({…}) as typeof describe`: the call through its wrappers.
  if (!ts.isCallExpression(unwrap(chain))) return false;
  const p = chain.parent;
  return (isVariableInitializer(chain) && ts.isIdentifier(p.name)) || ts.isExpressionStatement(p);
}

/** Line numbers exempted by a `// check-test-gating-ignore-next-line: <reason>` comment. */
export function pragmaLines(sf) {
  const text = sf.text;
  const seen = new Set();
  const lines = new Set();
  // Trivia scanning from a token next to JSX text would read `// …` in that text as a comment.
  const jsxText = [];
  const collectJsxText = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) jsxText.push([node.pos, node.end]);
    ts.forEachChild(node, collectJsxText);
  };
  collectJsxText(sf);
  const inJsxText = (pos) => jsxText.some(([a, b]) => pos >= a && pos < b);
  const visit = (node) => {
    // JSX text and JSDoc are not line comments; a marker in either exempts nothing.
    if (node.kind === ts.SyntaxKind.JsxText || ts.isJSDoc(node)) return;
    if (node.kind < ts.SyntaxKind.FirstNode || node.kind === ts.SyntaxKind.EndOfFileToken) {
      const comments = [
        ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
        ...(ts.getTrailingCommentRanges(text, node.end) ?? []),
      ];
      for (const c of comments) {
        if (seen.has(c.pos) || c.kind !== ts.SyntaxKind.SingleLineCommentTrivia || inJsxText(c.pos)) continue;
        seen.add(c.pos);
        if (PRAGMA.test(text.slice(c.pos, c.end))) lines.add(sf.getLineAndCharacterOfPosition(c.pos).line + 2);
      }
    }
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  return lines;
}

/**
 * Every reference to Vitest or the sanctioned gate in `sf`, as refs the entry's `RULES` judge:
 * a describe/suite/it/test use (see `testRef`), or a use the check can't follow (see `unreadableRef`).
 */
export function collectRefs(sf, bindings) {
  const refs = [];
  const visit = (node) => {
    if (!ts.isIdentifier(node) || isValueReference(node)) {
      const fnName = testFnName(node, bindings);
      if (fnName !== undefined) refs.push(testRef(node, fnName, bindings));
      else if (isVitestModuleUse(node, bindings) && !isReadableNamespaceUse(node)) {
        refs.push(unreadableRef(node));
      }
    }
    // `integrationSuite` (or its module's namespace) used other than by calling it: an alias the
    // check can't follow, such as `const g = integrationSuite`.
    if (ts.isIdentifier(node) && isValueReference(node)) {
      const bindingKind = kindOf(node, bindings);
      const outer = outermostWrapper(node);
      if (bindingKind === KIND_SUITE_FACTORY && calleeOf(outer.parent) !== outer) refs.push(unreadableRef(node));
      if (bindingKind === KIND_AMBIGUOUS) refs.push(unreadableRef(node));
      // `I.isIntegrationRequired()` and other named members read through; `I.integrationSuite` must be called.
      const member = memberOn(node);
      const readable = member !== undefined && linkName(member) !== undefined &&
        (!isSuiteFactory(member, bindings) || calleeOf(outermostWrapper(member).parent) === outermostWrapper(member));
      if (bindingKind === KIND_INTEGRATION_NS && !readable) {
        refs.push(unreadableRef(node));
      }
    }
    // `const ia = vi.importActual`, `const { importActual } = vi`: a loader taken off `vi` before
    // the call loads a module the check can't name.
    if (isDetachedLoader(node)) refs.push(unreadableRef(node));
    // `Reflect.get(vi, "importActual")`, `vi[k]`: `vi` used where the loader it reads can't be named.
    if (ts.isIdentifier(node) && isValueReference(node) && isUnreadableViUse(node, bindings)) refs.push(unreadableRef(node));
    // `import d = v.<name>` other than `v.describe`/`v.it`/…: an alias the check can't follow.
    if (ts.isImportEqualsDeclaration(node) && ts.isQualifiedName(node.moduleReference) && kindOf(node.name, bindings) !== KIND_FN) {
      let root = node.moduleReference;
      while (ts.isQualifiedName(root)) root = root.left;
      // `import g = describe.skipIf`, `import f = I.integrationSuite`: any root the bindings know.
      if (bindings.resolve(root) !== undefined) refs.push(unreadableRef(node.moduleReference));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return refs;
}
