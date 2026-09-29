import { describe, expect, it } from "vitest";
import { redactConnectionString } from "./index.js";

describe("redactConnectionString (sqlite)", () => {
  it("returns file paths unchanged (SQLite has no credentials)", () => {
    expect(redactConnectionString("./data/app.db")).toBe("./data/app.db");
    expect(redactConnectionString(":memory:")).toBe(":memory:");
  });
});
