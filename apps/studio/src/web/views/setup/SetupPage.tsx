import { useCallback, useMemo, useRef, useState } from "react";
import { Check, Database, FileKey, Loader2, Sparkles, Wand2 } from "lucide-react";
import type { SetupConfigResponse, SetupStatusDto } from "@/shared/api";
import { setupIntrospect, setupWriteConfig } from "../../api";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { CopyButton } from "../../components/common/CopyButton";

const selectClassName =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

type SetupDatabase = "postgres" | "mysql" | "sqlite" | "sqlserver" | "prisma";
type SetupAiProvider = "openai" | "anthropic" | "google" | "azure";

const DATABASES: Array<{ value: SetupDatabase; label: string }> = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "sqlite", label: "SQLite" },
  { value: "sqlserver", label: "SQL Server" },
  { value: "prisma", label: "Prisma schema file (no live database)" },
];

const AI_PROVIDERS: Array<{ value: SetupAiProvider; label: string; keyEnv: string }> = [
  { value: "openai", label: "OpenAI", keyEnv: "OPENAI_API_KEY" },
  { value: "anthropic", label: "Anthropic", keyEnv: "ANTHROPIC_API_KEY" },
  { value: "google", label: "Google", keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY" },
  { value: "azure", label: "Azure OpenAI", keyEnv: "AZURE_OPENAI_API_KEY" },
];

const CONNECTION_ENV_DEFAULTS: Record<SetupDatabase, string> = {
  postgres: "DATABASE_URL",
  mysql: "MYSQL_URL",
  sqlserver: "SQLSERVER_URL",
  sqlite: "",
  prisma: "",
};

export function SetupPage({
  status,
  onComplete,
}: {
  status: SetupStatusDto;
  onComplete: () => void;
}) {
  const configAlreadyExists = status.reason === "no-artifact";

  const [database, setDatabase] = useState<SetupDatabase>("postgres");
  const [connectionEnv, setConnectionEnv] = useState("DATABASE_URL");
  const connectionEnvTouched = useRef(false);
  const [sqliteFile, setSqliteFile] = useState("./data.db");
  const [prismaSchema, setPrismaSchema] = useState("");
  const [aiProvider, setAiProvider] = useState<SetupAiProvider>("openai");
  const [aiKeyEnv, setAiKeyEnv] = useState("OPENAI_API_KEY");
  const aiKeyEnvTouched = useRef(false);
  const [schemaOut, setSchemaOut] = useState("./askdb");

  const [configResult, setConfigResult] = useState<SetupConfigResponse | null>(null);
  const [busy, setBusy] = useState<"config" | "introspect" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needsConnectionEnv = database === "postgres" || database === "mysql" || database === "sqlserver";
  const configDone = configAlreadyExists || configResult !== null;

  const envVarsToFill = useMemo(() => {
    if (configResult) return configResult.envVars;
    if (needsConnectionEnv) {
      return [
        { name: connectionEnv, purpose: `${database} connection URL`, requiredForIntrospection: true },
        { name: aiKeyEnv, purpose: `${aiProvider} API key`, requiredForIntrospection: false },
      ];
    }
    return [{ name: aiKeyEnv, purpose: `${aiProvider} API key`, requiredForIntrospection: false }];
  }, [configResult, needsConnectionEnv, connectionEnv, database, aiKeyEnv, aiProvider]);

  const envSnippet = envVarsToFill.map((v) => `${v.name}=`).join("\n");

  const pickDatabase = useCallback((value: SetupDatabase) => {
    setDatabase(value);
    if (!connectionEnvTouched.current) setConnectionEnv(CONNECTION_ENV_DEFAULTS[value] || "DATABASE_URL");
  }, []);

  const pickAiProvider = useCallback((value: SetupAiProvider) => {
    setAiProvider(value);
    if (!aiKeyEnvTouched.current) {
      setAiKeyEnv(AI_PROVIDERS.find((p) => p.value === value)?.keyEnv ?? "OPENAI_API_KEY");
    }
  }, []);

  const handleWriteConfig = useCallback(async () => {
    setBusy("config");
    setError(null);
    try {
      const result = await setupWriteConfig({
        database,
        aiProvider,
        ...(needsConnectionEnv && connectionEnv ? { connectionEnv } : {}),
        ...(database === "sqlite" && sqliteFile ? { sqliteFile } : {}),
        ...(database === "prisma" && prismaSchema ? { prismaSchema } : {}),
        ...(aiKeyEnv ? { aiKeyEnv } : {}),
        ...(schemaOut ? { schemaOut } : {}),
      });
      setConfigResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [database, aiProvider, needsConnectionEnv, connectionEnv, sqliteFile, prismaSchema, aiKeyEnv, schemaOut]);

  const handleIntrospect = useCallback(async () => {
    setBusy("introspect");
    setError(null);
    try {
      await setupIntrospect();
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [onComplete]);

  return (
    <div className="app-shell" style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", overflow: "auto", padding: "48px 16px" }}>
      <div style={{ width: "100%", maxWidth: 640, display: "grid", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            <Wand2 size={18} /> Set up AskDB
          </h1>
          <p className="muted" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>
            {configAlreadyExists
              ? <>Config found at <code className="mono">{status.configPath}</code>, but no schema artifact yet. Run introspection to create it.</>
              : <>No <code className="mono">askdb.config.ts</code> found in <code className="mono">{status.projectDir}</code>. Answer two questions and Studio writes it for you — your secrets stay in <code className="mono">.env</code>, on your machine.</>}
          </p>
        </div>

        {!configAlreadyExists && (
          <div className="card">
            <div className="card-hd">
              <h3><Database size={14} /> 1 · Database &amp; model provider</h3>
              {configResult && <span className="chip green"><Check size={11} /> config written</span>}
            </div>
            <div className="card-bd" style={{ display: "grid", gap: 12 }}>
              <Field label="Database engine">
                <select
                  className={selectClassName}
                  value={database}
                  disabled={Boolean(configResult)}
                  onChange={(e) => pickDatabase(e.target.value as SetupDatabase)}
                >
                  {DATABASES.map((db) => (
                    <option key={db.value} value={db.value}>{db.label}</option>
                  ))}
                </select>
              </Field>

              {needsConnectionEnv && (
                <Field
                  label="Connection URL env var name"
                  description="The NAME of the environment variable — the actual URL goes in .env, never here."
                >
                  <Input
                    value={connectionEnv}
                    disabled={Boolean(configResult)}
                    onChange={(e) => { setConnectionEnv(e.target.value.toUpperCase()); connectionEnvTouched.current = true; }}
                  />
                </Field>
              )}

              {database === "sqlite" && (
                <Field label="SQLite file path" description="Relative to the project root.">
                  <Input value={sqliteFile} disabled={Boolean(configResult)} onChange={(e) => setSqliteFile(e.target.value)} />
                </Field>
              )}

              {database === "prisma" && (
                <Field label="Prisma schema path" description="Leave empty to auto-discover prisma/schema.prisma.">
                  <Input value={prismaSchema} disabled={Boolean(configResult)} onChange={(e) => setPrismaSchema(e.target.value)} placeholder="./prisma/schema.prisma" />
                </Field>
              )}

              <Field label="AI provider">
                <select
                  className={selectClassName}
                  value={aiProvider}
                  disabled={Boolean(configResult)}
                  onChange={(e) => pickAiProvider(e.target.value as SetupAiProvider)}
                >
                  {AI_PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </Field>

              <Field
                label="API key env var name"
                description="The NAME of the environment variable holding your model API key."
              >
                <Input
                  value={aiKeyEnv}
                  disabled={Boolean(configResult)}
                  onChange={(e) => { setAiKeyEnv(e.target.value.toUpperCase()); aiKeyEnvTouched.current = true; }}
                />
              </Field>

              <Field label="Schema artifact directory" description="Where introspection writes the schema artifact.">
                <Input value={schemaOut} disabled={Boolean(configResult)} onChange={(e) => setSchemaOut(e.target.value)} />
              </Field>

              {!configResult && (
                <div>
                  <button type="button" className="btn primary" disabled={busy === "config"} onClick={() => void handleWriteConfig()}>
                    {busy === "config" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    Write askdb.config.ts
                  </button>
                </div>
              )}
              {configResult && (
                <div style={{ display: "grid", gap: 6 }}>
                  <p className="muted" style={{ fontSize: 12.5 }}>
                    Wrote <code className="mono">{configResult.configPath}</code>
                    {configResult.envExamplePath ? <> and <code className="mono">{configResult.envExamplePath}</code></> : null}
                    {configResult.packageJsonCreated ? <> (plus a minimal <code className="mono">package.json</code>)</> : null}.
                  </p>
                  {configResult.installed && configResult.installed.length > 0 && (
                    <p className="muted" style={{ fontSize: 12.5 }}>
                      Installed into your project: <code className="mono">{configResult.installed.join(" ")}</code>.
                    </p>
                  )}
                  {configResult.manualInstallCommand && (
                    <div style={{ display: "grid", gap: 6, border: "1px solid var(--amber-500)", borderRadius: 6, padding: 10 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>One manual step: install the dependencies</span>
                      <p className="muted" style={{ fontSize: 12 }}>
                        The wizard couldn't install packages automatically. Run this in your project, then continue below:
                      </p>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <code className="mono" style={{ flex: 1, fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", background: "var(--surface-2)" }}>
                          {configResult.manualInstallCommand}
                        </code>
                        <CopyButton value={configResult.manualInstallCommand} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {configDone && (
          <div className="card">
            <div className="card-hd">
              <h3><FileKey size={14} /> {configAlreadyExists ? "1" : "2"} · Add your secrets to .env</h3>
            </div>
            <div className="card-bd" style={{ display: "grid", gap: 10 }}>
              <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                Create a <code className="mono">.env</code> file next to <code className="mono">askdb.config.ts</code> and
                fill in the values. Studio never asks for secret values — they stay on disk, outside this UI.
              </p>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <pre className="mono" style={{ flex: 1, margin: 0, border: "1px solid var(--border)", borderRadius: 6, padding: 10, fontSize: 12, background: "var(--surface-2)" }}>
                  {envVarsToFill.map((v) => `${v.name}=          # ${v.purpose}`).join("\n")}
                </pre>
                <CopyButton value={envSnippet} />
              </div>
            </div>
          </div>
        )}

        {configDone && (
          <div className="card">
            <div className="card-hd">
              <h3><Sparkles size={14} /> {configAlreadyExists ? "2" : "3"} · Introspect your database</h3>
            </div>
            <div className="card-bd" style={{ display: "grid", gap: 10 }}>
              <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                Reads your schema structure (tables, columns, relationships — never rows) and writes the
                schema artifact. When it finishes, Studio opens on the Overview.
              </p>
              <div>
                <button type="button" className="btn primary" disabled={busy === "introspect"} onClick={() => void handleIntrospect()}>
                  {busy === "introspect" ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                  Run introspection
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="card" style={{ borderColor: "var(--red-600)" }}>
            <div className="card-bd">
              <p style={{ color: "var(--red-600)", fontSize: 12.5, whiteSpace: "pre-wrap" }}>{error}</p>
            </div>
          </div>
        )}

        <p className="muted tiny" style={{ lineHeight: 1.6 }}>
          Prefer the terminal? <code className="mono">npx askdb init</code> runs the same setup as a CLI wizard.
        </p>
      </div>
    </div>
  );
}
