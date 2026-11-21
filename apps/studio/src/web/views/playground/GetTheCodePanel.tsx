import { useMemo, useState } from "react";
import { Code2 } from "lucide-react";
import { useWorkspace } from "../../contexts/workspace-context";
import { usePlayground } from "../../contexts/playground-context";
import { CopyButton } from "../../components/common/CopyButton";
import { snippetInstallLine, type SnippetWiring } from "../../lib/install-line";
import { AI_PROVIDERS, type AiProviderWiring } from "../setup/types";

const fieldsetResetStyle = { border: 0, padding: 0, margin: 0 };

/**
 * The SDK wiring for the workspace's provider, from the setup wizard's `AI_PROVIDERS` list
 * (drift-tested against `@askdb/ai` in `setup-providers.test.ts`). `azure-openai` is an
 * `@askdb/ai` alias with no wizard entry, so it falls back to the azure row; anything
 * unknown falls back to openai, as before.
 */
function providerWiring(aiProvider: string): AiProviderWiring {
  const found = AI_PROVIDERS.find((provider) => provider.value === aiProvider);
  if (found) return found;
  if (aiProvider === "azure-openai") return AI_PROVIDERS.find((provider) => provider.value === "azure")!;
  return AI_PROVIDERS.find((provider) => provider.value === "openai")!;
}

export function GetTheCodePanel() {
  const { workspace } = useWorkspace();
  const {
    askQuestion,
    askTenantEnabled,
    generatedTenantScopeJson,
    askTenantSqlMode,
  } = usePlayground();
  const [wiring, setWiring] = useState<SnippetWiring>("client");

  const snippet = useMemo(() => {
    if (!workspace) return "";
    const question = askQuestion.trim() || "Which customers signed up last week?";
    const wiringDef = providerWiring(workspace.aiProvider);
    // The gateway ships with `ai` itself, so it has no SDK package to install.
    const sdkPackage = wiringDef.sdkPackage ?? "ai";
    const schemaPath = workspace.schemaPathRelative;
    const tenant = askTenantEnabled && generatedTenantScopeJson ? generatedTenantScopeJson : null;

    if (wiring === "client") {
      const overrides = tenant
        ? `, {\n  tenantScope: ${indentBlock(tenant, 2)},\n  tenantSqlMode: ${JSON.stringify(askTenantSqlMode)},\n}`
        : "";
      const bundledSdk = wiringDef.sdkPackage === undefined;
      const providerNote = bundledSdk
        ? "the AI Gateway provider ships with `ai`"
        : `${sdkPackage} is loaded on first use`;
      return `// ${snippetInstallLine("client", sdkPackage)}
import { createAskDb } from "@askdb/client";
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";

// Reads the same askdb.config.ts + .env this Studio session uses.
bootstrapAskDbEnv({ cwd: process.cwd() });

const askdb = createAskDb({
  // ai.provider in askdb.config.ts picks the model; ${providerNote}.
  config: getAskDbRuntimeConfig(),
  schema: { path: ${JSON.stringify(schemaPath)} },
});

const { sql${tenant && askTenantSqlMode === "sql-params" ? ", tenantParams" : ""} } = await askdb.ask(
  ${JSON.stringify(question)}${overrides ? indentBlock(overrides, 2) : ""}
);

// AskDB returns checked SQL — it never executes it.
// Run it through your own pool under a read-only role${tenant && askTenantSqlMode === "sql-params" ? ", binding tenantParams" : ""}.`;
    }

    const tenantOptions = tenant
      ? `\n  tenantScope: ${indentBlock(tenant, 2)},\n  tenantSqlMode: ${JSON.stringify(askTenantSqlMode)},`
      : "";
    return `// ${snippetInstallLine("core", sdkPackage)}
import { ask, loadSchema } from "@askdb/core";
import { ${wiringDef.sdkImport} } from "${sdkPackage}";

const schema = loadSchema(${JSON.stringify(schemaPath)});
const model = ${wiringDef.sdkModel(workspace.model)};

const { sql${tenant && askTenantSqlMode === "sql-params" ? ", tenantParams" : ""} } = await ask({
  question: ${JSON.stringify(question)},
  schema,
  dialect: ${JSON.stringify(workspace.dialect)},
  model,${tenantOptions}
});

// AskDB returns checked SQL — it never executes it.
// Run it through your own pool under a read-only role${tenant && askTenantSqlMode === "sql-params" ? ", binding tenantParams" : ""}.`;
  }, [workspace, wiring, askQuestion, askTenantEnabled, generatedTenantScopeJson, askTenantSqlMode]);

  if (!workspace) return null;

  return (
    <section style={{ padding: "var(--pad-y) var(--pad-x)", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
          <Code2 size={14} /> Get the code
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <fieldset className="toggle-seg" style={fieldsetResetStyle}>
            <legend className="sr-only">Integration style</legend>
            <button className={wiring === "client" ? "active" : ""} onClick={() => setWiring("client")}>
              Config-driven
            </button>
            <button className={wiring === "core" ? "active" : ""} onClick={() => setWiring("core")}>
              Direct ask()
            </button>
          </fieldset>
          {workspace.dialect !== null && <CopyButton value={snippet} />}
        </div>
      </div>
      {workspace.dialect === null ? (
        // The artifact's engine has no AskDB dialect, so `ask()` would refuse this schema (ADR 0039).
        <p className="muted" style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
          No code to copy: {workspace.dialectError}
        </p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>
            This exact question, schema ({workspace.schemaPathRelative}), dialect ({workspace.dialect}), and
            provider ({workspace.aiProvider}) — as it runs in your own Node service.
          </p>
          <pre className="plain-block" style={{ fontSize: 11.5, overflow: "auto" }}>{snippet}</pre>
        </>
      )}
      <p className="muted tiny" style={{ marginTop: 8 }}>
        Full walkthrough:{" "}
        <a href="https://askdb.tools/guides/embed-in-node/" target="_blank" rel="noreferrer">
          Embed AskDB in a Node app
        </a>
      </p>
    </section>
  );
}

function indentBlock(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? line : pad + line))
    .join("\n");
}
