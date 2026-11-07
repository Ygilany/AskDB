import { describe, expect, it } from "vitest";
import * as api from "./index.js";

// Unused outside @askdb/core and removed from its public API before 1.0 (#654).
describe("@askdb/core public API", () => {
  it.each([
    "placeholderForRoot",
    "ENRICHMENT_SYSTEM_PROMPT",
    "buildEnrichmentUserPrompt",
    "parseCandidates",
  ])("@askdb/core doesn't export %s", (name) => {
    expect(api).not.toHaveProperty(name);
  });
});
