import { describe, expect, it } from "vitest";
import * as api from "./index.js";

// Unused outside @askdb/ai and removed from its public API before 1.0 (#654).
describe("@askdb/ai public API", () => {
  it.each([
    "aiKeyMissingMessage",
    "aiProviderMissingMessage",
    "isReasoningEffort",
  ])("@askdb/ai doesn't export %s", (name) => {
    expect(api).not.toHaveProperty(name);
  });
});
