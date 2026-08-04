import { describe, expect, it } from "vitest";
import { isReasoningEffort, REASONING_EFFORTS, resolveReasoningEffort } from "./reasoning.js";

describe("REASONING_EFFORTS / isReasoningEffort", () => {
  it("accepts the four portable effort levels", () => {
    expect(REASONING_EFFORTS).toEqual(["minimal", "low", "medium", "high"]);
    for (const level of REASONING_EFFORTS) {
      expect(isReasoningEffort(level)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isReasoningEffort("ultra")).toBe(false);
    expect(isReasoningEffort("")).toBe(false);
  });
});

describe("resolveReasoningEffort", () => {
  it("returns undefined (provider/model default) when nothing is configured", () => {
    expect(resolveReasoningEffort({})).toBeUndefined();
    expect(resolveReasoningEffort({}, "nlToSql")).toBeUndefined();
  });

  it("prefers an explicit programmatic override over env", () => {
    expect(
      resolveReasoningEffort(
        { ASKDB_AI_REASONING_EFFORT: "high", ASKDB_AI_REASONING_EFFORT_NL_TO_SQL: "medium" },
        "nlToSql",
        "low",
      ),
    ).toBe("low");
  });

  it("prefers the call-site-scoped env var over the global one", () => {
    expect(
      resolveReasoningEffort(
        {
          ASKDB_AI_REASONING_EFFORT: "high",
          ASKDB_AI_REASONING_EFFORT_NL_TO_SQL: "medium",
        },
        "nlToSql",
      ),
    ).toBe("medium");
    expect(
      resolveReasoningEffort(
        {
          ASKDB_AI_REASONING_EFFORT: "high",
          ASKDB_AI_REASONING_EFFORT_ENRICHMENT: "low",
        },
        "enrichment",
      ),
    ).toBe("low");
  });

  it("falls back to the global effort when the call site has no override", () => {
    expect(
      resolveReasoningEffort({ ASKDB_AI_REASONING_EFFORT: "high" }, "enrichment"),
    ).toBe("high");
  });

  it("falls back to the global effort when no purpose is given", () => {
    expect(resolveReasoningEffort({ ASKDB_AI_REASONING_EFFORT: "medium" })).toBe("medium");
  });

  it("ignores invalid env values and falls through to undefined", () => {
    expect(
      resolveReasoningEffort(
        { ASKDB_AI_REASONING_EFFORT_NL_TO_SQL: "ultra", ASKDB_AI_REASONING_EFFORT: "nope" },
        "nlToSql",
      ),
    ).toBeUndefined();
  });
});
