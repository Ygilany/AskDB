import { Check, Database, Loader2 } from "lucide-react";
import type { SetupConfigResponse } from "@/shared/api";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { CopyButton } from "../../components/common/CopyButton";
import { EnvVarField } from "./EnvVarField";
import {
  AI_PROVIDERS,
  DATABASES,
  EXECUTE_PROVIDERS,
  RAG_STORES,
  type SetupAiProvider,
  type SetupDatabase,
  type SetupExecuteProvider,
  type SetupRagStore,
} from "./types";

const selectClassName =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function DatabaseProviderCard({
  stepNumber,
  configResult,
  busy,
  database,
  onDatabaseChange,
  needsConnectionEnv,
  connectionEnv,
  onConnectionEnvChange,
  sqliteFile,
  onSqliteFileChange,
  prismaSchema,
  onPrismaSchemaChange,
  aiProvider,
  onAiProviderChange,
  aiKeyEnv,
  onAiKeyEnvChange,
  aiModelEnv,
  onAiModelEnvChange,
  schemaOut,
  onSchemaOutChange,
  ragStore,
  onRagStoreChange,
  pgvectorEnv,
  onPgvectorEnvChange,
  studioExecuteEnabled,
  onStudioExecuteEnabledChange,
  studioExecuteProvider,
  onStudioExecuteProviderChange,
  studioExecuteConnectionEnv,
  onStudioExecuteConnectionEnvChange,
  studioExecuteSqliteFile,
  onStudioExecuteSqliteFileChange,
  onWriteConfig,
}: {
  stepNumber: number;
  configResult: SetupConfigResponse | null;
  busy: "config" | "introspect" | null;
  database: SetupDatabase;
  onDatabaseChange: (value: SetupDatabase) => void;
  needsConnectionEnv: boolean;
  connectionEnv: string;
  onConnectionEnvChange: (value: string) => void;
  sqliteFile: string;
  onSqliteFileChange: (value: string) => void;
  prismaSchema: string;
  onPrismaSchemaChange: (value: string) => void;
  aiProvider: SetupAiProvider;
  onAiProviderChange: (value: SetupAiProvider) => void;
  aiKeyEnv: string;
  onAiKeyEnvChange: (value: string) => void;
  aiModelEnv: string;
  onAiModelEnvChange: (value: string) => void;
  schemaOut: string;
  onSchemaOutChange: (value: string) => void;
  ragStore: SetupRagStore;
  onRagStoreChange: (value: SetupRagStore) => void;
  pgvectorEnv: string;
  onPgvectorEnvChange: (value: string) => void;
  studioExecuteEnabled: boolean;
  onStudioExecuteEnabledChange: (value: boolean) => void;
  studioExecuteProvider: SetupExecuteProvider;
  onStudioExecuteProviderChange: (value: SetupExecuteProvider) => void;
  studioExecuteConnectionEnv: string;
  onStudioExecuteConnectionEnvChange: (value: string) => void;
  studioExecuteSqliteFile: string;
  onStudioExecuteSqliteFileChange: (value: string) => void;
  onWriteConfig: () => void;
}) {
  const disabled = Boolean(configResult);

  return (
    <div className="card">
      <div className="card-hd">
        <h3><Database size={14} /> {stepNumber} · Database &amp; model provider</h3>
        {configResult && <span className="chip green"><Check size={11} /> config written</span>}
      </div>
      <div className="card-bd" style={{ display: "grid", gap: 12 }}>
        <Field label="Database engine">
          <select
            className={selectClassName}
            value={database}
            disabled={disabled}
            onChange={(e) => onDatabaseChange(e.target.value as SetupDatabase)}
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
            disabled={disabled}
            onChange={onConnectionEnvChange}
          />
        )}

        {database === "sqlite" && (
          <Field label="SQLite file path" description="Relative to the project root.">
            <Input value={sqliteFile} disabled={disabled} onChange={(e) => onSqliteFileChange(e.target.value)} />
          </Field>
        )}

        {database === "prisma" && (
          <Field label="Prisma schema path" description="Leave empty to auto-discover prisma/schema.prisma.">
            <Input
              value={prismaSchema}
              disabled={disabled}
              onChange={(e) => onPrismaSchemaChange(e.target.value)}
              placeholder="./prisma/schema.prisma"
            />
          </Field>
        )}

        <Field label="AI provider">
          <select
            className={selectClassName}
            value={aiProvider}
            disabled={disabled}
            onChange={(e) => onAiProviderChange(e.target.value as SetupAiProvider)}
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
          disabled={disabled}
          onChange={onAiKeyEnvChange}
        />

        <EnvVarField
          label="Model env var name (optional)"
          description="The NAME of the environment variable for a model override. Leave empty to use the provider default."
          value={aiModelEnv}
          disabled={disabled}
          onChange={onAiModelEnvChange}
        />

        <Field label="Schema artifact directory" description="Where introspection writes the schema artifact.">
          <Input value={schemaOut} disabled={disabled} onChange={(e) => onSchemaOutChange(e.target.value)} />
        </Field>

        <Field label="RAG store" description="Where table/relationship embeddings are indexed for retrieval.">
          <select
            className={selectClassName}
            value={ragStore}
            disabled={disabled}
            onChange={(e) => onRagStoreChange(e.target.value as SetupRagStore)}
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
            disabled={disabled}
            onChange={onPgvectorEnvChange}
          />
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={studioExecuteEnabled}
            disabled={disabled}
            onChange={(e) => onStudioExecuteEnabledChange(e.target.checked)}
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
                disabled={disabled}
                onChange={(e) => onStudioExecuteProviderChange(e.target.value as SetupExecuteProvider)}
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
                  disabled={disabled}
                  onChange={(e) => onStudioExecuteSqliteFileChange(e.target.value)}
                />
              </Field>
            ) : (
              <EnvVarField
                label="Connection URL env var name"
                description="The NAME of the environment variable — the actual URL goes in .env, never here."
                value={studioExecuteConnectionEnv}
                disabled={disabled}
                onChange={onStudioExecuteConnectionEnvChange}
              />
            )}
          </>
        )}

        {!configResult && (
          <div>
            <button type="button" className="btn primary" disabled={busy === "config"} onClick={onWriteConfig}>
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
  );
}
