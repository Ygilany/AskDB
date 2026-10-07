/**
 * The lab's rule for comparing the SQL AskDB returned with a cassette's (#477): `sameStatement` in
 * `src/model/catalog.ts`, which `lab:record`'s fence gate uses, and `expectCassetteSql`
 * (`test/support/cassette-sql.ts`), which the replay suites use.
 *
 * Protects: the two are equal once a single trailing `;` is removed from each, whichever side has
 * it. Released AskDB removes the `;` from the SQL it returns (`concepts/safety-boundaries.mdx`,
 * "Single statement") and #477 keeps it, while a recorded cassette's fence almost always ends with
 * one, so the lab must read both behaviors. Anything else still differs: a second `;`, a `;` in
 * the middle, another statement.
 * Catches: a comparison that normalizes only the cassette's side, so every recorded cassette fails
 * once `ask()` keeps the `;`; one that strips every trailing `;`, or every `;`, so a statement
 * AskDB should have rejected or changed compares equal; and a fence read from an untagged block,
 * which `ask()` reads and the replay suites don't.
 * Not covered elsewhere: the replay suites run against an AskDB that removes the `;`, so the side
 * of the comparison that handles a kept `;` is never exercised by them until #477 ships.
 * No production seam: plain functions over strings, and one real cassette read from disk.
 */
import { describe, expect, it } from "vitest";
import { cassetteSql, fencedSql, sameStatement } from "../src/model/catalog.js";
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

  it("accepts AskDB's SQL for a cassette whether or not it kept the semicolon, and nothing else", () => {
    const sql = cassetteSql("sqlite", "agency-names");

    expect(() => expectCassetteSql(sql, "sqlite", "agency-names")).not.toThrow();
    expect(() => expectCassetteSql(`${sql};`, "sqlite", "agency-names")).not.toThrow();
    expect(() => expectCassetteSql(`${sql} LIMIT 1`, "sqlite", "agency-names")).toThrow();
    expect(() => expectCassetteSql(`${sql};;`, "sqlite", "agency-names")).toThrow();
    expect(() => expectCassetteSql(undefined, "sqlite", "agency-names")).toThrow();
  });
});
