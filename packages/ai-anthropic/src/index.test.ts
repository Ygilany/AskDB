import * as ai from "@askdb/ai";
import { describe, expect, it } from "vitest";
import * as shim from "./index.js";

describe("@askdb/ai-anthropic (deprecated shim)", () => {
  it("re-exports the built-in adapter from @askdb/ai", () => {
    expect(Object.keys(shim)).toEqual(["anthropicProvider"]);
    expect(shim.anthropicProvider).toBe(ai.anthropicProvider);
    expect(ai.createAiRegistry([shim.anthropicProvider]).hasProvider("anthropic")).toBe(true);
  });
});
