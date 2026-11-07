import { describe, expect, it } from "vitest";
import * as client from "./index.js";

describe("@askdb/client public API", () => {
  it("exports resolveDialect, the dialect rule createAskDb runs (#886)", () => {
    expect(typeof client.resolveDialect).toBe("function");
  });
});
