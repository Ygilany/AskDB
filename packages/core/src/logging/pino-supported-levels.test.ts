import { describe, expect, it } from "vitest";
import {
  formatSupportedAskDbLogLevels,
  isSupportedAskDbLogLevel,
} from "./pino-supported-levels.js";

describe("pino-supported-levels", () => {
  it("isSupportedAskDbLogLevel narrows and rejects unknown labels", () => {
    expect(isSupportedAskDbLogLevel("info")).toBe(true);
    expect(isSupportedAskDbLogLevel("silent")).toBe(true);
    expect(isSupportedAskDbLogLevel("bogus")).toBe(false);
  });

  it("formatSupportedAskDbLogLevels lists sorted names", () => {
    expect(formatSupportedAskDbLogLevels()).toBe("debug, error, fatal, info, silent, trace, warn");
  });
});
