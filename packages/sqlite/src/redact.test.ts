import { describe, expect, it } from "vitest";
import { redactConnectionString } from "./index.js";

describe("redactConnectionString (sqlite)", () => {
  it("returns plain file paths unchanged", () => {
    expect(redactConnectionString("./data/app.db")).toBe("./data/app.db");
    expect(redactConnectionString(":memory:")).toBe(":memory:");
    expect(redactConnectionString("file:./data/app.db?mode=ro&cache=shared")).toBe(
      "file:./data/app.db?mode=ro&cache=shared",
    );
  });

  it("masks encryption keys and passwords in file: URI query params", () => {
    expect(redactConnectionString("file:./data/app.db?mode=ro&key=S3cret&cache=shared")).toBe(
      "file:./data/app.db?mode=ro&key=****&cache=shared",
    );
    expect(redactConnectionString("file:app.db?hexkey=2DD29CA8&password=S3cret")).toBe(
      "file:app.db?hexkey=****&password=****",
    );
  });

  it("masks to the end when a secret is followed by a segment that is not key=value", () => {
    expect(redactConnectionString("file:app.db?key=S3&cret&mode=ro")).toBe("file:app.db?key=****");
  });
});
