import { describe, expect, it } from "vitest";
import { AskDbError } from "../errors.js";
import {
  DEFAULT_ASKDB_MODE,
  formatAskDbModesV1,
  parseAskDbModeV1,
} from "./types.js";

describe("parseAskDbModeV1", () => {
  it("defaults to schema_only", () => {
    expect(parseAskDbModeV1(undefined)).toBe(DEFAULT_ASKDB_MODE);
    expect(parseAskDbModeV1("")).toBe(DEFAULT_ASKDB_MODE);
  });

  it("accepts aliases with case and hyphen insensitivity", () => {
    expect(parseAskDbModeV1("SCHEMA_ONLY")).toBe("schema_only");
    expect(parseAskDbModeV1("bounded-results")).toBe("bounded_results");
  });

  it("rejects unknown modes", () => {
    expect(() => parseAskDbModeV1("full_ai")).toThrow(AskDbError);
  });
});

describe("formatAskDbModesV1", () => {
  it("lists pipe-separated ids for help text", () => {
    expect(formatAskDbModesV1()).toMatch(/schema_only/);
    expect(formatAskDbModesV1()).toMatch(/bounded_results/);
  });
});
