import * as kit from "@askdb/introspect/kit";
import { describe, expect, it } from "vitest";
import * as connectors from "./index.js";

describe("@askdb/connectors redaction re-exports", () => {
  it("re-exports the @askdb/introspect/kit redaction helpers unchanged", () => {
    expect(connectors.REDACTED_SECRET).toBe(kit.REDACTED_SECRET);
    expect(connectors.hasUrlScheme).toBe(kit.hasUrlScheme);
    expect(connectors.isSecretConnectionKey).toBe(kit.isSecretConnectionKey);
    expect(connectors.redactConnectionStringGeneric).toBe(kit.redactConnectionStringGeneric);
    expect(connectors.redactSecretKeyValues).toBe(kit.redactSecretKeyValues);
    expect(connectors.redactUrlUserinfo).toBe(kit.redactUrlUserinfo);
  });
});
