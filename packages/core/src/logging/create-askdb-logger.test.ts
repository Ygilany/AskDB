import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAskDbLogger } from "./create-askdb-logger.js";
import { AskDbLogEvent } from "./log-events.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    const obj = JSON.parse(line!) as { correlationId?: string; event?: string };
    expect(obj.correlationId).toBe(cid);
    expect(obj.event).toBe(AskDbLogEvent.RunStart);
  });
});
