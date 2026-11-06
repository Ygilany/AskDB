import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAskDbLogger } from "./create-askdb-logger.js";
import { ASKDB_LOG_REQUIRED_FIELDS } from "./log-contract.js";
import { AskDbLogEvent } from "./log-events.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Open file descriptors in this process: `/dev/fd` lists them on Linux and macOS. */
function openFdCount(): number {
  return readdirSync("/dev/fd").length;
}

describe("createAskDbLogger", () => {
  it("writes JSON lines with correlationId and event to a file sink", () => {
    const dir = mkdtempSync(join(__dirname, "log-fixture-"));
    const file = join(dir, `run-${randomUUID()}.log`);
    const cid = "corr-test-1";
    const logger = createAskDbLogger({
      correlationId: cid,
      level: "info",
      stderr: false,
      logFile: file,
    });
    logger.info({ event: AskDbLogEvent.RunStart }, "test line");
    const text = readFileSync(file, "utf8");
    rmSync(dir, { recursive: true, force: true });
    const line = text.trim().split("\n")[0];
    expect(line).toBeTruthy();
    const obj = JSON.parse(line!) as Record<string, unknown>;
    expect(obj.correlationId).toBe(cid);
    expect(obj.event).toBe(AskDbLogEvent.RunStart);
    for (const f of ASKDB_LOG_REQUIRED_FIELDS) expect(obj[f]).toBeTruthy();
    expect(ASKDB_LOG_REQUIRED_FIELDS).toEqual(expect.arrayContaining(["event", "correlationId"]));
  });

  it("opens a log file once, however many loggers write to it", () => {
    // Hosts build one logger per request (the correlation ID is the request ID), so a file
    // opened per logger leaks one descriptor per request (#693).
    const dir = mkdtempSync(join(__dirname, "log-fixture-"));
    const file = join(dir, "shared.log");
    const log = (correlationId: string) =>
      createAskDbLogger({ correlationId, level: "info", stderr: false, logFile: file }).info(
        { event: AskDbLogEvent.RunStart },
        "request",
      );
    try {
      log("req-0");
      const before = openFdCount();
      for (let i = 1; i <= 50; i++) log(`req-${i}`);
      const opened = openFdCount() - before;

      const ids = readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .map((line) => (JSON.parse(line) as { correlationId: string }).correlationId);
      expect(ids).toEqual(Array.from({ length: 51 }, (_, i) => `req-${i}`));
      expect(opened).toBeLessThan(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a logFile that ends in a path separator, without creating a file", () => {
    const dir = mkdtempSync(join(__dirname, "log-fixture-"));
    try {
      expect(() =>
        createAskDbLogger({ correlationId: "c", level: "info", stderr: false, logFile: join(dir, "logs") + sep }),
      ).toThrow();
      expect(existsSync(join(dir, "logs"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
