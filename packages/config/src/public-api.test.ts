import { describe, expect, it } from "vitest";
import * as config from "./index.js";
import { getAskDbRuntimeConfig, resetAskDbRuntimeForTests } from "./index.js";
import * as scaffold from "./scaffold/index.js";

// Unused outside @askdb/config and removed from its public API before 1.0 (#654).
describe("@askdb/config public API", () => {
  it.each([
    "bootstrapAskDbRuntime",
    "ASKDB_CONFIG_EXTENSION_PRECEDENCE",
    "DEFAULT_HTTP_API_REQUEST_TIMEOUT_MS",
    "DEFAULT_PGVECTOR_INDEX_STRATEGY",
    "DEFAULT_MOCK_RAG_EMBEDDING_DIMENSIONS",
    "DEFAULT_STUDIO_EXECUTE_MAX_ROWS",
    "DEFAULT_STUDIO_EXECUTE_TIMEOUT_MS",
  ])("@askdb/config doesn't export %s", (name) => {
    expect(config).not.toHaveProperty(name);
  });

  it("@askdb/config/scaffold doesn't export renderAskDbAiConfigScaffold", () => {
    expect(scaffold).not.toHaveProperty("renderAskDbAiConfigScaffold");
  });

  it("the not-initialized error names bootstrapAskDbEnv() alone", () => {
    resetAskDbRuntimeForTests();
    expect(() => getAskDbRuntimeConfig()).toThrow(
      "AskDB runtime is not initialized. Call bootstrapAskDbEnv() from @askdb/config after startup",
    );
  });
});
