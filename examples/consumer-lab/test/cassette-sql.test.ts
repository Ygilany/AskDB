/**
 * The lab's rule for comparing the SQL AskDB returned with a cassette's (#477): `sameStatement` in
 * `src/model/catalog.ts`, `fenceHoldsSql`, which is `lab:record`'s fence gate, and
 * `expectCassetteSql` (`test/support/cassette-sql.ts`), which the replay suites use.
 *
 * Protects: the two are equal once a single trailing `;` is removed from each, whichever side has
 * it. AskDB up to `1.0.0-beta.43` removes the `;` from the SQL it returns, and later versions
 * keep it (#477, `concepts/safety-boundaries.mdx`, "Single statement"), while a recorded cassette's
 * fence almost always ends with one, so the lab must read both behaviors. Anything else still differs: a second `;`, a `;` in
 * the middle, another statement.
 * Catches: a comparison that normalizes only the cassette's side, so every recorded cassette fails
 * once `ask()` keeps the `;`; one that strips every trailing `;`, or every `;`, so a statement
 * AskDB should have rejected or changed compares equal; and a fence read from an untagged block,
 * which `ask()` reads and the replay suites don't.
 * Not covered elsewhere: on the committed baseline (`1.0.0-beta.43`) the replay suites and
 * `record.test.ts` run against an AskDB that removes the `;`, so they exercise the side of the
 * comparison that handles a kept `;` only on `lab:use .` or a later release.
 * No production seam: plain functions over strings, and one real cassette read from disk.
 */
import { describe, expect, it } from "vitest";
import { cassetteSql, fenceHoldsSql, fencedSql, sameStatement } from "../src/model/catalog.js";
import { expectCassetteSql } from "./support/cassette-sql.js";

describe("cassette SQL", () => {
  it("compares SQL without a single trailing semicolon, on either side", () => {
    expect(sameStatement("SELECT 1", "SELECT 1")).toBe(true);
    expect(sameStatement("SELECT 1;", "SELECT 1")).toBe(true);
    expect(sameStatement("SELECT 1", "SELECT 1;")).toBe(true);
    expect(sameStatement("SELECT 1 ;\n", "  SELECT 1")).toBe(true);
  });

  it("still tells statements apart by anything other than that one semicolon", () => {
    expect(sameStatement("SELECT 1;;", "SELECT 1")).toBe(false);
    expect(sameStatement("SELECT 1; SELECT 2", "SELECT 1 SELECT 2")).toBe(false);
    expect(sameStatement("SELECT 1;", "SELECT 2")).toBe(false);
    expect(sameStatement("SELECT ';'", "SELECT ''")).toBe(false);
  });

  it("reads only a sql-tagged fence, without its terminator", () => {
    expect(fencedSql("```sql\nSELECT agency_id\nFROM agency;\n```")).toBe("SELECT agency_id\nFROM agency");
    expect(fencedSql("```sql\nSELECT 1\n```\n\n```sql-unbound\nSELECT :p\n```")).toBe("SELECT 1");
    expect(fencedSql("```\nSELECT 1;\n```")).toBeUndefined();
  });

  it("lets lab:record write a reply whose sql fence holds what ask() returned, whether or not either side kept the semicolon", () => {
    for (const asked of ["SELECT 1", "SELECT 1;"]) {
      expect(fenceHoldsSql("```sql\nSELECT 1\n```", asked)).toBe(true);
      expect(fenceHoldsSql("```sql\nSELECT 1;\n```", asked)).toBe(true);
      expect(fenceHoldsSql("```sql\nSELECT 2;\n```", asked)).toBe(false);
      expect(fenceHoldsSql("```\nSELECT 1;\n```", asked)).toBe(false);
      expect(fenceHoldsSql("SELECT 1;", asked)).toBe(false);
    }
  });

  it("accepts AskDB's SQL for a cassette whether or not it kept the semicolon, and nothing else", () => {
    const sql = cassetteSql("sqlite", "agency-names");

    expect(() => expectCassetteSql(sql, "sqlite", "agency-names")).not.toThrow();
    expect(() => expectCassetteSql(`${sql};`, "sqlite", "agency-names")).not.toThrow();
    expect(() => expectCassetteSql(`${sql} LIMIT 1`, "sqlite", "agency-names")).toThrow();
    expect(() => expectCassetteSql(`${sql};;`, "sqlite", "agency-names")).toThrow();
    expect(() => expectCassetteSql(undefined, "sqlite", "agency-names")).toThrow();
  });
});
