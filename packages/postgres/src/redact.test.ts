import { describe, expect, it } from "vitest";
import { redactConnectionString } from "./index.js";

describe("redactConnectionString (postgres)", () => {
  it("masks the URL userinfo password", () => {
    expect(redactConnectionString("postgresql://app:S3cret@db:5432/app")).toBe(
      "postgresql://app:****@db:5432/app",
    );
  });

  it("masks secret query params (password, sslpassword) but not other params", () => {
    expect(
      redactConnectionString("postgres://db/app?user=app&password=S3cret&sslmode=require&sslpassword=k"),
    ).toBe("postgres://db/app?user=app&password=****&sslmode=require&sslpassword=****");
  });

  it("masks libpq keyword/value strings, including quoted values with spaces", () => {
    expect(redactConnectionString("host=db user=app password=S3cret dbname=app")).toBe(
      "host=db user=app password=**** dbname=app",
    );
    expect(redactConnectionString("host=db password='se cr\\'et' dbname=app")).toBe(
      "host=db password=**** dbname=app",
    );
  });

  it("leaves credential-free strings unchanged", () => {
    expect(redactConnectionString("postgres://localhost/app")).toBe("postgres://localhost/app");
  });
});
