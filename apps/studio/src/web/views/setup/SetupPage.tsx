import { useCallback, useMemo, useRef, useState } from "react";
import { Check, Database, FileKey, Loader2, Pencil, Sparkles, Wand2 } from "lucide-react";
import type { SetupConfigResponse, SetupStatusDto } from "@/shared/api";
import { setupIntrospect, setupWriteConfig } from "../../api";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { CopyButton } from "../../components/common/CopyButton";

const selectClassName =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * An env var NAME field, shown as a static default until clicked. Naming an
 * env var rarely matters — showing an editable input for it up front just
 * adds a decision nobody asked for. Click-to-edit keeps the default visible
 * without hiding that it can be changed.
 */
function EnvVarField({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (editing && !disabled) {
    return (
      <Field label={label} description={description}>
        <Input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </Field>
    );
  }

  return (
    <Field label={label} description={description}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          width: "100%",
          height: 36,
          padding: "0 12px",
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "var(--surface-2)",
          cursor: disabled ? "default" : "pointer",
          textAlign: "left",
        }}
      >
        <span className="mono" style={{ fontSize: 13 }}>{value}</span>
        {!disabled && <Pencil size={12} className="muted" />}
      </button>
    </Field>
  );
}

type SetupDatabase = "postgres" | "mysql" | "sqlite" | "sqlserver" | "prisma";
type SetupAiProvider = "openai" | "anthropic" | "google" | "azure" | "foundry";
type SetupRagStore = "file" | "memory" | "pgvector";
type SetupExecuteProvider = "postgres" | "mysql" | "sqlite" | "sqlserver";

const DATABASES: Array<{ value: SetupDatabase; label: string }> = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "sqlite", label: "SQLite" },
  { value: "sqlserver", label: "SQL Server" },
  { value: "prisma", label: "Prisma schema file (no live database)" },
];

const AI_PROVIDERS: Array<{ value: SetupAiProvider; label: string; keyEnv: string; modelEnv: string }> = [
  { value: "openai", label: "OpenAI", keyEnv: "OPENAI_API_KEY", modelEnv: "OPENAI_MODEL" },
  { value: "anthropic", label: "Anthropic", keyEnv: "ANTHROPIC_API_KEY", modelEnv: "ANTHROPIC_MODEL" },
  { value: "google", label: "Google", keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY", modelEnv: "GOOGLE_GENERATIVE_AI_MODEL" },
  { value: "azure", label: "Azure OpenAI", keyEnv: "AZURE_OPENAI_API_KEY", modelEnv: "AZURE_OPENAI_DEPLOYMENT" },
  { value: "foundry", label: "Azure AI Foundry", keyEnv: "AZURE_OPENAI_API_KEY", modelEnv: "AZURE_OPENAI_DEPLOYMENT" },
];

const RAG_STORES: Array<{ value: SetupRagStore; label: string }> = [
  { value: "file", label: "File (default, no setup required)" },
  { value: "memory", label: "Memory (fast, non-persistent)" },
  { value: "pgvector", label: "pgvector (Postgres vector store)" },
];

const EXECUTE_PROVIDERS: Array<{ value: SetupExecuteProvider; label: string }> = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "sqlite", label: "SQLite" },
  { value: "sqlserver", label: "SQL Server" },
];

const CONNECTION_ENV_DEFAULTS: Record<SetupDatabase, string> = {
  postgres: "DATABASE_URL",
  mysql: "MYSQL_URL",
  sqlserver: "SQLSERVER_URL",
  sqlite: "",
  prisma: "",
};

const EXECUTE_CONNECTION_ENV_DEFAULTS: Record<SetupExecuteProvider, string> = {
  postgres: "DATABASE_URL",
  mysql: "MYSQL_URL",
  sqlserver: "SQLSERVER_URL",
  sqlite: "",
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
  const [aiModelEnv, setAiModelEnv] = useState("OPENAI_MODEL");
  const aiModelEnvTouched = useRef(false);
  const [schemaOut, setSchemaOut] = useState("./askdb");
  const [ragStore, setRagStore] = useState<SetupRagStore>("file");
  const [pgvectorEnv, setPgvectorEnv] = useState("ASKDB_PGVECTOR_URL");
  const [studioExecuteEnabled, setStudioExecuteEnabled] = useState(true);
  const studioExecuteEnabledTouched = useRef(false);
  const [studioExecuteProvider, setStudioExecuteProvider] = useState<SetupExecuteProvider>("postgres");
  const [studioExecuteConnectionEnv, setStudioExecuteConnectionEnv] = useState("DATABASE_URL");
  const studioExecuteConnectionEnvTouched = useRef(false);
  const [studioExecuteSqliteFile, setStudioExecuteSqliteFile] = useState("./data.db");

  const [configResult, setConfigResult] = useState<SetupConfigResponse | null>(null);
  const [busy, setBusy] = useState<"config" | "introspect" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needsConnectionEnv = database === "postgres" || database === "mysql" || database === "sqlserver";
  const configDone = configAlreadyExists || configResult !== null;

  const envVarsToFill = useMemo(() => {
    if (configResult) return configResult.envVars;
    const vars = new Map<string, { name: string; purpose: string; requiredForIntrospection: boolean }>();
    const add = (v: { name: string; purpose: string; requiredForIntrospection: boolean }) => {
      if (!v.name || vars.has(v.name)) return;
      vars.set(v.name, v);
    };
    add({ name: aiKeyEnv, purpose: `${aiProvider} API key`, requiredForIntrospection: false });
    if (aiModelEnv) add({ name: aiModelEnv, purpose: `${aiProvider} model override`, requiredForIntrospection: false });
    if (needsConnectionEnv) {
      add({ name: connectionEnv, purpose: `${database} connection URL`, requiredForIntrospection: true });
    }
    if (ragStore === "pgvector") {
      add({ name: pgvectorEnv, purpose: "pgvector connection URL", requiredForIntrospection: false });
    }
    if (studioExecuteEnabled) {
      const effectiveProvider = database === "prisma" ? studioExecuteProvider : (database as SetupExecuteProvider);
      if (effectiveProvider !== "sqlite") {
        const envName = database === "prisma" ? studioExecuteConnectionEnv : connectionEnv;
        add({ name: envName, purpose: `${effectiveProvider} connection URL (Studio execute)`, requiredForIntrospection: false });
      }
    }
    return Array.from(vars.values());
  }, [
    configResult,
    aiKeyEnv,
    aiProvider,
    aiModelEnv,
    needsConnectionEnv,
    connectionEnv,
    database,
    ragStore,
    pgvectorEnv,
    studioExecuteEnabled,
    studioExecuteProvider,
    studioExecuteConnectionEnv,
  ]);

  const envSnippet = envVarsToFill.map((v) => `${v.name}=`).join("\n");

  const pickDatabase = useCallback((value: SetupDatabase) => {
    setDatabase(value);
    if (!connectionEnvTouched.current) setConnectionEnv(CONNECTION_ENV_DEFAULTS[value] || "DATABASE_URL");
    if (!studioExecuteEnabledTouched.current) setStudioExecuteEnabled(value !== "prisma");
  }, []);

  const pickAiProvider = useCallback((value: SetupAiProvider) => {
    setAiProvider(value);
    const defaults = AI_PROVIDERS.find((p) => p.value === value);
    if (!aiKeyEnvTouched.current) setAiKeyEnv(defaults?.keyEnv ?? "OPENAI_API_KEY");
    if (!aiModelEnvTouched.current) setAiModelEnv(defaults?.modelEnv ?? "");
  }, []);

  const pickStudioExecuteProvider = useCallback((value: SetupExecuteProvider) => {
    setStudioExecuteProvider(value);
    if (!studioExecuteConnectionEnvTouched.current) {
      setStudioExecuteConnectionEnv(EXECUTE_CONNECTION_ENV_DEFAULTS[value] || "DATABASE_URL");
    }
  }, []);

  const handleWriteConfig = useCallback(async () => {
    setBusy("config");
    setError(null);
    try {
      const effectiveExecuteProvider = database === "prisma" ? studioExecuteProvider : (database as SetupExecuteProvider);
      const result = await setupWriteConfig({
        database,
        aiProvider,
        ...(needsConnectionEnv && connectionEnv ? { connectionEnv } : {}),
        ...(database === "sqlite" && sqliteFile ? { sqliteFile } : {}),
        ...(database === "prisma" && prismaSchema ? { prismaSchema } : {}),
        ...(aiKeyEnv ? { aiKeyEnv } : {}),
        ...(aiModelEnv ? { aiModelEnv } : {}),
        ...(schemaOut ? { schemaOut } : {}),
        ragStore,
        ...(ragStore === "pgvector" && pgvectorEnv ? { pgvectorEnv } : {}),
        studioExecute: studioExecuteEnabled,
        ...(studioExecuteEnabled
          ? {
              studioExecuteProvider: effectiveExecuteProvider,
              ...(effectiveExecuteProvider === "sqlite"
                ? { studioExecuteSqliteFile: database === "prisma" ? studioExecuteSqliteFile : sqliteFile }
                : {
                    studioExecuteConnectionEnv: database === "prisma" ? studioExecuteConnectionEnv : connectionEnv,
                  }),
            }
          : {}),
      });
      setConfigResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [
    database,
    aiProvider,
    needsConnectionEnv,
    connectionEnv,
    sqliteFile,
    prismaSchema,
    aiKeyEnv,
    aiModelEnv,
    schemaOut,
    ragStore,
    pgvectorEnv,
    studioExecuteEnabled,
    studioExecuteProvider,
    studioExecuteConnectionEnv,
    studioExecuteSqliteFile,
  ]);

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
                <EnvVarField
                  label="Connection URL env var name"
                  description="The NAME of the environment variable — the actual URL goes in .env, never here."
                  value={connectionEnv}
                  disabled={Boolean(configResult)}
                  onChange={(v) => { setConnectionEnv(v); connectionEnvTouched.current = true; }}
                />
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

              <EnvVarField
                label="API key env var name"
                description="The NAME of the environment variable holding your model API key."
                value={aiKeyEnv}
                disabled={Boolean(configResult)}
                onChange={(v) => { setAiKeyEnv(v); aiKeyEnvTouched.current = true; }}
              />

              <EnvVarField
                label="Model env var name (optional)"
                description="The NAME of the environment variable for a model override. Leave empty to use the provider default."
                value={aiModelEnv}
                disabled={Boolean(configResult)}
                onChange={(v) => { setAiModelEnv(v); aiModelEnvTouched.current = true; }}
              />

              <Field label="Schema artifact directory" description="Where introspection writes the schema artifact.">
                <Input value={schemaOut} disabled={Boolean(configResult)} onChange={(e) => setSchemaOut(e.target.value)} />
              </Field>

              <Field label="RAG store" description="Where table/relationship embeddings are indexed for retrieval.">
                <select
                  className={selectClassName}
                  value={ragStore}
                  disabled={Boolean(configResult)}
                  onChange={(e) => setRagStore(e.target.value as SetupRagStore)}
                >
                  {RAG_STORES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </Field>

              {ragStore === "pgvector" && (
                <EnvVarField
                  label="pgvector connection URL env var name"
                  description="The NAME of the environment variable — the actual URL goes in .env, never here."
                  value={pgvectorEnv}
                  disabled={Boolean(configResult)}
                  onChange={setPgvectorEnv}
                />
              )}

              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={studioExecuteEnabled}
                  disabled={Boolean(configResult)}
                  onChange={(e) => { setStudioExecuteEnabled(e.target.checked); studioExecuteEnabledTouched.current = true; }}
                />
                <span style={{ fontSize: 13 }}>Enable Studio execute (run queries from the browser playground)</span>
              </label>

              {studioExecuteEnabled && database === "prisma" && (
                <>
                  <Field
                    label="Studio execute database"
                    description="Prisma has no live database of its own — pick one for the browser playground to run queries against."
                  >
                    <select
                      className={selectClassName}
                      value={studioExecuteProvider}
                      disabled={Boolean(configResult)}
                      onChange={(e) => pickStudioExecuteProvider(e.target.value as SetupExecuteProvider)}
                    >
                      {EXECUTE_PROVIDERS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </Field>

                  {studioExecuteProvider === "sqlite" ? (
                    <Field label="SQLite file path" description="Relative to the project root.">
                      <Input
                        value={studioExecuteSqliteFile}
                        disabled={Boolean(configResult)}
                        onChange={(e) => setStudioExecuteSqliteFile(e.target.value)}
                      />
                    </Field>
                  ) : (
                    <EnvVarField
                      label="Connection URL env var name"
                      description="The NAME of the environment variable — the actual URL goes in .env, never here."
                      value={studioExecuteConnectionEnv}
                      disabled={Boolean(configResult)}
                      onChange={(v) => { setStudioExecuteConnectionEnv(v); studioExecuteConnectionEnvTouched.current = true; }}
                    />
                  )}
                </>
              )}

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
