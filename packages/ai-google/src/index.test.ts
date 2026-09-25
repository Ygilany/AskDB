import * as ai from "@askdb/ai";
import { describe, expect, it } from "vitest";
import * as shim from "./index.js";

describe("@askdb/ai-google (deprecated shim)", () => {
  it("re-exports the built-in adapter from @askdb/ai", () => {
    expect(Object.keys(shim)).toEqual(["googleProvider"]);
    expect(shim.googleProvider).toBe(ai.googleProvider);
    expect(ai.createAiRegistry([shim.googleProvider]).hasProvider("google")).toBe(true);
  });
});
