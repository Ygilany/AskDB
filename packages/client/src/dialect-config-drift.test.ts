/**
 * `@askdb/config` keeps its own dialect list and must not depend on `@askdb/core`, so the
 * list is hand-kept — and no test checked it against core's built-in ids (#661).
 * `@askdb/client` depends on both packages, so the guard that the two agree lives here,
 * next to the AI-provider drift test.
 */
import { ASKDB_DIALECTS } from "@askdb/config";
import { SUPPORTED_DIALECT_IDS } from "@askdb/core";
import { describe, expect, it } from "vitest";

describe("@askdb/config agrees with @askdb/core's built-in dialect table", () => {
  it("ASKDB_DIALECTS lists every built-in dialect id, and only built-in dialect ids", () => {
    expect([...ASKDB_DIALECTS].sort()).toEqual([...SUPPORTED_DIALECT_IDS].sort());
  });
});
