import { describe, expect, it } from "vitest";
import type { AnyNormalizedSchema } from "@askdb/core";
import { DialectNotSupportedError } from "./errors.js";
import { resolveDialect } from "./index.js";

/** A schema with only what the dialect rule reads: its `provider`, when it has one. */
function schemaWith(provider?: string): AnyNormalizedSchema {
  return { version: 2, schemaId: "s", tables: [], ...(provider ? { provider } : {}) } as unknown as AnyNormalizedSchema;
}

describe("resolveDialect", () => {
  it.each([
    ["an override, over everything", schemaWith("snowflake"), { override: "mysql", configDialect: "sqlite" }, { dialect: "mysql", source: "override" }],
    ["the config dialect, over a matching provider", schemaWith("postgres"), { configDialect: "postgres" }, { dialect: "postgres", source: "config" }],
    [
      "the config dialect, noting a provider it overrides",
      schemaWith("snowflake"),
      { configDialect: "postgres" },
      { dialect: "postgres", source: "config", note: "Using config dialect 'postgres'; schema declared provider 'snowflake'." },
    ],
    ["a built-in provider", schemaWith("mysql"), {}, { dialect: "mysql", source: "schema" }],
    ["postgres, with no provider", schemaWith(), {}, { dialect: "postgres", source: "default" }],
    [
      "postgres for an unknown provider, only when asked to fall back",
      schemaWith("snowflake"),
      { unknownDialect: "fallback-postgres" },
      { dialect: "postgres", source: "default", note: "Schema declared provider 'snowflake' with no shipped DialectSpec; defaulting to 'postgres'." },
    ],
  ] as const)("picks %s", (_case, schema, options, expected) => {
    expect(resolveDialect(schema, options)).toEqual(expected);
  });

  it("refuses an unknown provider with DialectNotSupportedError, naming it and the dialect key", () => {
    let error: unknown;
    try {
      resolveDialect(schemaWith("snowflake"));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DialectNotSupportedError);
    expect((error as DialectNotSupportedError).provider).toBe("snowflake");
    expect((error as Error).message).toContain("set `dialect: \"postgres\"` (or another supported id) in askdb.config.*");
  });
});
