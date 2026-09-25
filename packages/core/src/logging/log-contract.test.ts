import { describe, expect, it } from "vitest";
import { ASKDB_LOG_REQUIRED_FIELDS } from "./log-contract.js";

describe("log contract", () => {
  it("requires minimal log fields", () => {
    expect(ASKDB_LOG_REQUIRED_FIELDS).toEqual(["event", "correlationId"]);
  });
});

