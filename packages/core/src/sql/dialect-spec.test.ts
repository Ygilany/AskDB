import { describe, expect, it } from "vitest";
import {
  BUILT_IN_DIALECTS,
  COCKROACHDB_DIALECT,
  POSTGRES_DIALECT,
  SUPPORTED_DIALECT_IDS,
  getDialectSpec,
  isBuiltInDialectId,
} from "./dialect-spec.js";

describe("DialectSpec registry", () => {
  it("ships POSTGRES_DIALECT under id 'postgres'", () => {
    expect(POSTGRES_DIALECT.id).toBe("postgres");
    expect(BUILT_IN_DIALECTS.postgres).toBe(POSTGRES_DIALECT);
    expect(getDialectSpec("postgres")).toBe(POSTGRES_DIALECT);
  });

  it("ships COCKROACHDB_DIALECT that reuses Postgres syntax", () => {
    expect(COCKROACHDB_DIALECT.id).toBe("cockroachdb");
    expect(COCKROACHDB_DIALECT.promptBrief).toBe(POSTGRES_DIALECT.promptBrief);
    expect(getDialectSpec("cockroachdb")).toBe(COCKROACHDB_DIALECT);
  });

  it("isBuiltInDialectId narrows shipped ids", () => {
    expect(isBuiltInDialectId("postgres")).toBe(true);
    expect(isBuiltInDialectId("cockroachdb")).toBe(true);
    expect(isBuiltInDialectId("mysql")).toBe(false);
    expect(isBuiltInDialectId("not-a-dialect")).toBe(false);
    expect(isBuiltInDialectId(42)).toBe(false);
  });

  it("SUPPORTED_DIALECT_IDS enumerates shipped specs", () => {
    expect(SUPPORTED_DIALECT_IDS).toEqual(expect.arrayContaining(["postgres", "cockroachdb"]));
  });
});
