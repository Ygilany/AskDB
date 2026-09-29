import { describe, expect, it } from "vitest";
import { redactConnectionString } from "./index.js";

describe("redactConnectionString (mysql)", () => {
  it("masks the URL userinfo password", () => {
    expect(redactConnectionString("mysql://root:S3cret@localhost:3306/shop")).toBe(
      "mysql://root:****@localhost:3306/shop",
    );
  });

  it("masks secret query params", () => {
    expect(redactConnectionString("mysql://localhost/shop?user=root&password=S3cret&ssl=true")).toBe(
      "mysql://localhost/shop?user=root&password=****&ssl=true",
    );
  });

  it("masks ADO.NET-style Pwd/Password pairs", () => {
    expect(redactConnectionString("Server=localhost;Uid=root;Pwd=S3cret;Database=shop")).toBe(
      "Server=localhost;Uid=root;Pwd=****;Database=shop",
    );
  });
});
