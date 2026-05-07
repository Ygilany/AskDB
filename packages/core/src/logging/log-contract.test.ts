import { describe, expect, it } from "vitest";
import { AskDbLogEvent } from "./log-events.js";
import { ASKDB_LOG_REQUIRED_EVENTS, ASKDB_LOG_REQUIRED_FIELDS } from "./log-contract.js";

describe("log contract", () => {
  it("requires minimal log fields", () => {
    expect(ASKDB_LOG_REQUIRED_FIELDS).toEqual(["event", "correlationId"]);
  });

  it("required events are present in AskDbLogEvent", () => {
    const all = new Set(Object.values(AskDbLogEvent));
    for (const evt of ASKDB_LOG_REQUIRED_EVENTS) {
      expect(all.has(evt)).toBe(true);
    }
  });
});

