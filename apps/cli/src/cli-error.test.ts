import { afterEach, describe, expect, it, vi } from "vitest";
import { printCliError } from "./cli-error.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("printCliError", () => {
  // A driver's AggregateError has an empty message of its own (#749).
  it("prints each inner error of an empty AggregateError once, with any URL's password masked", () => {
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
          new Error("could not reach postgres://reader:s3cret@db.internal:5432/shop"),
          Object.assign(new Error(""), { code: "ETIMEDOUT" }),
        ],
        "",
      ),
    );
    expect(stderr).toBe(
      "connect ECONNREFUSED ::1:5432\ncould not reach postgres://reader:***@db.internal:5432/shop\nETIMEDOUT\n",
    );
  });
});
