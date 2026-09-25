import { describe, expect, it } from "vitest";
import { prismaConnectorProvider } from "./provider.js";

const resolve = prismaConnectorProvider.resolveConnection!;
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
      sourceLabel: "auto-discovered prisma/schema.prisma",
    });
  });

  it("rejects --url and --from-export", () => {
    const error = "Use --prisma-schema with --engine prisma, not --url or --from-export.";
    expect(resolve({ explicit: { url: "postgres://h/db" }, runtime: runtime() })).toEqual({ ok: false, error });
    expect(resolve({ explicit: { fromExport: "./b" }, runtime: runtime() })).toEqual({ ok: false, error });
  });
});
