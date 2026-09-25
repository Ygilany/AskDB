import * as ai from "@askdb/ai";
import { describe, expect, it } from "vitest";
import * as shim from "./index.js";

describe("@askdb/ai-openai (deprecated shim)", () => {
  it("re-exports the built-in adapter from @askdb/ai", () => {
    expect(Object.keys(shim)).toEqual(["openaiProvider"]);
    expect(shim.openaiProvider).toBe(ai.openaiProvider);
    expect(ai.createAiRegistry([shim.openaiProvider]).hasProvider("openai")).toBe(true);
  });
});
