import { describe, expect, it } from "vitest";
import * as api from "./index.js";

// Unused outside @askdb/introspect and removed from its public API before 1.0 (#654).
describe("@askdb/introspect public API", () => {
  it.each([
    "connectorProviderMissingMessage",
  ])("@askdb/introspect doesn't export %s", (name) => {
    expect(api).not.toHaveProperty(name);
  });
});
