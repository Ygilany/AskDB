import { ASKDB_INTROSPECTION_PROVIDERS, ASKDB_RAG_STORES, ASKDB_STUDIO_EXECUTE_PROVIDERS } from "@askdb/config";
import { planAskDbScaffold, type AskDbScaffoldAnswers } from "@askdb/config/scaffold";
import { describe, expect, it } from "vitest";
import {
  CONNECTION_ENV_DEFAULTS,
  DATABASES,
  EXECUTE_CONNECTION_ENV_DEFAULTS,
  EXECUTE_PROVIDERS,
  RAG_STORES,
} from "./web/views/setup/types.js";
import { PRISMA_BUILD_APPROVALS } from "./prisma-install.js";

// The browser bundle keeps its own copy of the engine lists (it can't import the planner).
// The planner's engine table is keyed by `ASKDB_INTROSPECTION_PROVIDERS`, and it accepts the
// `ASKDB_STUDIO_EXECUTE_PROVIDERS` for Studio execute and the `ASKDB_RAG_STORES`.
describe("Studio setup wizard engines", () => {
  const base: AskDbScaffoldAnswers = {
    database: "postgres",
    schemaOut: "./askdb",
    ai: { provider: "openai", keyEnv: "OPENAI_API_KEY" },
    rag: { store: "file" },
  };
  const VERSIONS = { config: "1.0.0", prisma: "1.0.0" };
  const sorted = (values: readonly string[]) => [...values].sort();

  it("offer the engines, execute providers and RAG stores the planner scaffolds", () => {
    expect(sorted(DATABASES.map((d) => d.value))).toEqual(sorted(ASKDB_INTROSPECTION_PROVIDERS));
    expect(sorted(Object.keys(CONNECTION_ENV_DEFAULTS))).toEqual(sorted(ASKDB_INTROSPECTION_PROVIDERS));
    expect(sorted(EXECUTE_PROVIDERS.map((p) => p.value))).toEqual(sorted(ASKDB_STUDIO_EXECUTE_PROVIDERS));
    expect(sorted(Object.keys(EXECUTE_CONNECTION_ENV_DEFAULTS))).toEqual(sorted(ASKDB_STUDIO_EXECUTE_PROVIDERS));
    expect(sorted(RAG_STORES.map((s) => s.value))).toEqual(sorted(ASKDB_RAG_STORES));
  });

  it.each(DATABASES.map((d) => d.value))("asks for %s's connection variable exactly when the planner reads one", (database) => {
    const plan = planAskDbScaffold(
      { ...base, database, connectionEnv: "WIZARD_URL", sqliteFile: { path: "./app.db" } },
      VERSIONS,
    );
    expect(plan.envVars.some((v) => v.name === "WIZARD_URL")).toBe(CONNECTION_ENV_DEFAULTS[database] !== "");
  });

  it.each(EXECUTE_PROVIDERS.map((p) => p.value))(
    "asks for %s's Studio execute connection variable exactly when the planner reads one",
    (provider) => {
      const plan = planAskDbScaffold(
        { ...base, database: "prisma", studioExecute: { provider, connectionEnv: "WIZARD_URL", sqliteFile: { path: "./app.db" } } },
        VERSIONS,
      );
      expect(plan.envVars.some((v) => v.name === "WIZARD_URL")).toBe(EXECUTE_CONNECTION_ENV_DEFAULTS[provider] !== "");
    },
  );

  // The introspection plan's missing-package hint keeps its own copy of the approvals.
  it("approves the same Prisma build in the introspection hint as the scaffold planner does", () => {
    expect(PRISMA_BUILD_APPROVALS).toEqual(planAskDbScaffold({ ...base, database: "prisma" }, VERSIONS).install.allowBuilds);
  });
});
