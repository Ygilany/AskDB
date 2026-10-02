import * as kit from "@askdb/introspect/kit";
import { describe, expect, it } from "vitest";
import * as connectors from "./index.js";

describe("@askdb/connectors connection-label re-exports", () => {
  it("re-exports the @askdb/introspect/kit label helpers unchanged", () => {
    expect(connectors.formatConnectionLabel).toBe(kit.formatConnectionLabel);
    expect(connectors.parseConnectionUrl).toBe(kit.parseConnectionUrl);
  });
});
