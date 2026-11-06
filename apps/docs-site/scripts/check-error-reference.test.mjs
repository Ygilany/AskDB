import assert from "node:assert/strict";
import { test } from "node:test";
import { missingFromPage } from "./check-error-reference.mjs";

// The shapes errors.ts uses: comments inside and around unions, classes on any base, and object
// types that aren't code lists. A `/*` inside a line comment or a string, before undocumented
// names, must not start a block comment that hides them.
const source = `
export class BaseError extends Error {
  constructor(message: string) {
    super(message);
    this.message = "see https://example.com"; // a trailing comment
  }
}
export abstract class ChildError extends BaseError {}
// Thrown when an @ai-sdk/* provider package can't be imported.
export class GrandchildError extends ChildError {
  readonly pattern = "src/*.ts";
}
export class WrappedFailure extends Base {}

export type RuleCode =
  | "RULE_ONE"
  /** A JSDoc comment between members, with a "QUOTED" word. */
  | "RULE_TWO"
  // A line comment between members.
  | 'RULE_THREE';

export type Kind = "lower-case" | "other";
export type Warning = { rule: RuleCode; tableId: string; label: "NOT_A_CODE" };
export type Finding =
  | { check: "a"; run: () => void }
  | { check: "b" };
`;

test("missingFromPage reports each undocumented error class and code, and nothing else", () => {
  const page = "`BaseError`, `ChildError`, `RULE_ONE`, `RULE_THREE`, \"lower-case\" and `other`.";

  assert.deepEqual(missingFromPage(source, page), ["GrandchildError", "WrappedFailure", "RULE_TWO"]);
});

test("missingFromPage throws for an export it can't classify, instead of skipping it", () => {
  const unclassifiable = [
    'export const REASONS = ["A", "B"] as const;',
    "export type Reason = (typeof REASONS)[number];",
    'export type Reason = OldReason | "NEW_REASON";',
    'export type Reason = { a: string; } | "NEW_REASON";',
    'export type { Reason } from "./reasons.js";',
    'export * from "./reasons.js";',
  ];
  for (const line of unclassifiable) {
    assert.throws(() => missingFromPage(`export class AError extends Error {}\n${line}`, "`AError`"), /extend the parser/, line);
  }
  assert.throws(() => missingFromPage("const x = 1;", ""), /no exported error class or code/);
});
