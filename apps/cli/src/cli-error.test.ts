import { afterEach, describe, expect, it, vi } from "vitest";
import { printCliError } from "./cli-error.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("printCliError", () => {
  // A driver's AggregateError has an empty message of its own (#749).
  it("prints each inner error of an empty AggregateError once", () => {
    let stderr = "";
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
    printCliError(
      new AggregateError(
        [
          new Error("connect ECONNREFUSED ::1:5432"),
          new Error("connect ECONNREFUSED ::1:5432"),
          new Error("connect ECONNREFUSED 127.0.0.1:5432"),
          Object.assign(new Error(""), { code: "ETIMEDOUT" }),
        ],
        "",
      ),
    );
    expect(stderr).toBe(
      "connect ECONNREFUSED ::1:5432\nconnect ECONNREFUSED 127.0.0.1:5432\nETIMEDOUT\n",
    );
  });
});
