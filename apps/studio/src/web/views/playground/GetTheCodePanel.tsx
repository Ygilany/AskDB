import { useMemo, useState } from "react";
import { Code2 } from "lucide-react";
import { useWorkspace } from "../../contexts/workspace-context";
import { usePlayground } from "../../contexts/playground-context";
import { CopyButton } from "../../components/common/CopyButton";

const fieldsetResetStyle = { border: 0, padding: 0, margin: 0 };

type Wiring = "client" | "core";

type ProviderWiring = {
  adapterPackage: string;
  adapterImport: string;
  sdkPackage: string;
  sdkImport: string;
  sdkModel: (model: string) => string;
};

const PROVIDER_WIRING: Record<string, ProviderWiring> = {
  openai: {
    adapterPackage: "@askdb/ai-openai",
    adapterImport: "openaiProvider",
    sdkPackage: "@ai-sdk/openai",
    sdkImport: "openai",
    sdkModel: (model) => `openai(${JSON.stringify(model)})`,
  },
  anthropic: {
    adapterPackage: "@askdb/ai-anthropic",
    adapterImport: "anthropicProvider",
    sdkPackage: "@ai-sdk/anthropic",
    sdkImport: "anthropic",
    sdkModel: (model) => `anthropic(${JSON.stringify(model)})`,
  },
  google: {
    adapterPackage: "@askdb/ai-google",
    adapterImport: "googleProvider",
    sdkPackage: "@ai-sdk/google",
    sdkImport: "google",
    sdkModel: (model) => `google(${JSON.stringify(model)})`,
  },
  azure: {
    adapterPackage: "@askdb/ai-azure",
    adapterImport: "azureProvider",
    sdkPackage: "@ai-sdk/azure",
    sdkImport: "azure",
    sdkModel: (model) => `azure(${JSON.stringify(model)}) // your deployment name`,
  },
};

function providerWiring(aiProvider: string): ProviderWiring {
  if (aiProvider in PROVIDER_WIRING) return PROVIDER_WIRING[aiProvider]!;
  if (aiProvider === "foundry" || aiProvider === "azure-openai") return PROVIDER_WIRING.azure!;
  return PROVIDER_WIRING.openai!;
}

export function GetTheCodePanel() {
  const { workspace } = useWorkspace();
  const {
    askQuestion,
    askTenantEnabled,
    generatedTenantScopeJson,
    askTenantSqlMode,
  } = usePlayground();
  const [wiring, setWiring] = useState<Wiring>("client");

  const snippet = useMemo(() => {
    if (!workspace) return "";
    const question = askQuestion.trim() || "Which customers signed up last week?";
    const wiringDef = providerWiring(workspace.aiProvider);
    const schemaPath = workspace.schemaPathRelative;
    const tenant = askTenantEnabled && generatedTenantScopeJson ? generatedTenantScopeJson : null;

    if (wiring === "client") {
      const overrides = tenant
        ? `, {\n  tenantScope: ${indentBlock(tenant, 2)},\n  tenantSqlMode: ${JSON.stringify(askTenantSqlMode)},\n}`
        : "";
      return `// npm install @askdb/client @askdb/config ${wiringDef.adapterPackage}
import { createAskDb } from "@askdb/client";
import { bootstrapAskDbEnv, getAskDbRuntimeConfig } from "@askdb/config";
import { ${wiringDef.adapterImport} } from "${wiringDef.adapterPackage}";

// Reads the same askdb.config.ts + .env this Studio session uses.
bootstrapAskDbEnv({ cwd: process.cwd() });

const askdb = createAskDb({
  config: getAskDbRuntimeConfig(),
  providers: [${wiringDef.adapterImport}],
  schema: { path: ${JSON.stringify(schemaPath)} },
});

const { sql${tenant && askTenantSqlMode === "sql-params" ? ", tenantParams" : ""} } = await askdb.ask(
  ${JSON.stringify(question)}${overrides ? indentBlock(overrides, 2) : ""}
);

// AskDB returns validated SQL — it never executes it.
// Run it through your own pool under a read-only role${tenant && askTenantSqlMode === "sql-params" ? ", binding tenantParams" : ""}.`;
    }

    const tenantOptions = tenant
      ? `\n  tenantScope: ${indentBlock(tenant, 2)},\n  tenantSqlMode: ${JSON.stringify(askTenantSqlMode)},`
      : "";
    return `// npm install @askdb/core ${wiringDef.sdkPackage}
import { ask, loadSchema } from "@askdb/core";
import { ${wiringDef.sdkImport} } from "${wiringDef.sdkPackage}";

const schema = loadSchema(${JSON.stringify(schemaPath)});
const model = ${wiringDef.sdkModel(workspace.model)};

const { sql${tenant && askTenantSqlMode === "sql-params" ? ", tenantParams" : ""} } = await ask({
  question: ${JSON.stringify(question)},
  schema,
  dialect: ${JSON.stringify(workspace.dialect)},
  model,${tenantOptions}
});

// AskDB returns validated SQL — it never executes it.
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
          <CopyButton value={snippet} />
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>
        This exact question, schema ({workspace.schemaPathRelative}), dialect ({workspace.dialect}), and
        provider ({workspace.aiProvider}) — as it runs in your own Node service.
      </p>
      <pre className="plain-block" style={{ fontSize: 11.5, overflow: "auto" }}>{snippet}</pre>
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
