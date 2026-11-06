import assert from "node:assert/strict";
import { test } from "node:test";
import { missingFromPage } from "./check-error-reference.mjs";

// The shapes errors.ts uses: JSDoc and line comments between union members, subclasses of
// subclasses, and types and classes that aren't error codes or error classes.
const source = `
export class BaseError extends Error {
  constructor(message: string) {
    super(message);
    this.message = "see https://example.com"; // a "://" in a string is not a comment
  }
}
export class ChildError extends BaseError {}
export class GrandchildError extends ChildError {}
export class Helper extends Base {}

export type RuleCode =
  | "RULE_ONE"
  /** A JSDoc comment between members, with a "QUOTED" word. */
  | "RULE_TWO"
  // A line comment between members.
  | "RULE_THREE";

export type Kind = "lower-case" | "other";
export type Mixed = "not_a_code" | SomeType;
export type Shape = { reason: "NOT_A_UNION" };
`;

test("missingFromPage reports each undocumented error class and code, and nothing else", () => {
  const page = "`BaseError`, `ChildError`, `RULE_ONE`, `RULE_THREE`, \"lower-case\" and `other`.";

  assert.deepEqual(missingFromPage(source, page), ["GrandchildError", "RULE_TWO"]);
});

test("missingFromPage throws when the source has no error class", () => {
  assert.throws(() => missingFromPage('export type Code = "A";', "`A`"), /no exported error class/);
});
