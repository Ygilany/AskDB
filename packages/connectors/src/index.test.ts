import * as introspect from "@askdb/introspect";
import * as kit from "@askdb/introspect/kit";
import { describe, expect, it } from "vitest";
import * as connectors from "./index.js";

describe("@askdb/connectors compatibility shim", () => {
  it("re-exports the @askdb/introspect registry unchanged", () => {
    expect(connectors.createConnectorRegistry).toBe(introspect.createConnectorRegistry);
    expect(connectors.connectorProviderMissingMessage).toBe(introspect.connectorProviderMissingMessage);
    expect(connectors.CONNECTOR_PROVIDERS).toBe(introspect.BUILT_IN_CONNECTOR_PROVIDERS);
    expect([...connectors.CONNECTOR_PROVIDERS]).toEqual(["postgres", "prisma", "mysql", "sqlite", "sqlserver"]);
  });

  it("re-exports the @askdb/introspect/kit redaction helpers unchanged", () => {
    expect(connectors.REDACTED_SECRET).toBe(kit.REDACTED_SECRET);
    expect(connectors.hasUrlScheme).toBe(kit.hasUrlScheme);
    expect(connectors.isSecretConnectionKey).toBe(kit.isSecretConnectionKey);
    expect(connectors.redactConnectionStringGeneric).toBe(kit.redactConnectionStringGeneric);
    expect(connectors.redactSecretKeyValues).toBe(kit.redactSecretKeyValues);
    expect(connectors.redactUrlUserinfo).toBe(kit.redactUrlUserinfo);
  });
});
