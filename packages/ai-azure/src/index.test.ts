import * as ai from "@askdb/ai";
import { describe, expect, it } from "vitest";
import * as shim from "./index.js";

describe("@askdb/ai-azure (deprecated shim)", () => {
  it("re-exports the built-in adapter from @askdb/ai", () => {
    expect(Object.keys(shim)).toEqual(["azureProvider"]);
    expect(shim.azureProvider).toBe(ai.azureProvider);
    expect(ai.createAiRegistry([shim.azureProvider]).hasProvider("foundry")).toBe(true);
  });
});
