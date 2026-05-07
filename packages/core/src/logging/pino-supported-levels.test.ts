import pino from "pino";
import { describe, expect, it } from "vitest";
import {
  formatSupportedAskDbLogLevels,
  isSupportedAskDbLogLevel,
  SUPPORTED_ASKDB_LOG_LEVELS,
} from "./pino-supported-levels.js";

describe("pino-supported-levels", () => {
  it("includes every default Pino numeric level plus silent", () => {
    for (const k of Object.keys(pino.levels.values)) {
      expect(SUPPORTED_ASKDB_LOG_LEVELS.has(k)).toBe(true);
    }
    expect(SUPPORTED_ASKDB_LOG_LEVELS.has("silent")).toBe(true);
  });

  it("isSupportedAskDbLogLevel narrows and rejects unknown labels", () => {
    expect(isSupportedAskDbLogLevel("info")).toBe(true);
    expect(isSupportedAskDbLogLevel("silent")).toBe(true);
    expect(isSupportedAskDbLogLevel("bogus")).toBe(false);
  });

  it("formatSupportedAskDbLogLevels lists sorted names", () => {
    expect(formatSupportedAskDbLogLevels()).toMatch(/debug/);
    expect(formatSupportedAskDbLogLevels()).toMatch(/silent/);
  });
});
