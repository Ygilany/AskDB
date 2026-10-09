import { describe, expect, it } from "vitest";
import { createConnectorRegistry, type ConnectorConnectionRequest } from "@askdb/introspect";
import { prismaConnectorProvider } from "./provider.js";

// Through the registry, which adds the label built from the adapter's parts (ADR 0011).
const registry = createConnectorRegistry([prismaConnectorProvider]);
const resolve = (request: ConnectorConnectionRequest) => registry.resolveConnection("prisma", request);
const runtime = (prismaSchemaPath?: string) => ({ introspection: { provider: "prisma", prismaSchemaPath } });

describe("prismaConnectorProvider.resolveConnection", () => {
  it("prefers an explicit --prisma-schema, then config, then auto-discovery", () => {
    expect(resolve({ explicit: { schemaPath: "./flag.prisma" }, runtime: runtime("./config.prisma") })).toEqual({
      ok: true,
      connection: { schemaPath: "./flag.prisma" },
      sourceLabel: "./flag.prisma",
    });
    expect(resolve({ runtime: runtime("./config.prisma") })).toEqual({
      ok: true,
      connection: { schemaPath: "./config.prisma" },
      sourceLabel: "./config.prisma",
    });
    expect(resolve({ runtime: runtime() })).toEqual({
      ok: true,
      connection: { schemaPath: undefined },
      sourceLabel: "configured prisma connection",
    });
  });

  it("falls back to the configured schema path when --prisma-schema is blank", () => {
    expect(resolve({ explicit: { schemaPath: "  " }, runtime: runtime("./config.prisma") })).toEqual({
      ok: true,
      connection: { schemaPath: "./config.prisma" },
      sourceLabel: "./config.prisma",
    });
  });

  it("rejects --url and --from-export", () => {
    const error = "Use --prisma-schema with --engine prisma, not --url or --from-export.";
    expect(resolve({ explicit: { url: "postgres://h/db" }, runtime: runtime() })).toEqual({ ok: false, error });
    expect(resolve({ explicit: { fromExport: "./b" }, runtime: runtime() })).toEqual({ ok: false, error });
  });
});
