import { expect } from "vitest";
import { cassetteSql, sameStatement, type Question } from "../../src/model/catalog.js";

/**
 * Asserts that SQL AskDB returned is a cassette's statement, by the lab's one rule for that
 * comparison (`sameStatement` in `src/model/catalog.ts`: equal once a trailing `;` is removed from
 * each side). On a mismatch the failure shows both statements as they are.
 */
export function expectCassetteSql(sql: string | undefined, dialect: string, questionId: string, questions?: Question[]): void {
  const expected = cassetteSql(dialect, questionId, questions);
  if (sql === undefined || !sameStatement(sql, expected)) expect(sql).toBe(expected);
}
