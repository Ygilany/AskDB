import { useCallback, useMemo, useRef, useState } from "react";
import { Wand2 } from "lucide-react";
import type { SetupConfigResponse, SetupStatusDto } from "@/shared/api";
import { setupIntrospect, setupWriteConfig } from "../../api";
import { DatabaseProviderCard } from "./DatabaseProviderCard";
import { SecretsCard } from "./SecretsCard";
import { IntrospectCard } from "./IntrospectCard";
import {
  AI_PROVIDERS,
  CONNECTION_ENV_DEFAULTS,
  EXECUTE_CONNECTION_ENV_DEFAULTS,
  type SetupAiProvider,
  type SetupDatabase,
  type SetupExecuteProvider,
  type SetupRagStore,
} from "./types";

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

  const secretsStep = configAlreadyExists ? 1 : 2;
  const introspectStep = configAlreadyExists ? 2 : 3;

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
          <DatabaseProviderCard
            stepNumber={1}
            configResult={configResult}
            busy={busy}
            database={database}
            onDatabaseChange={pickDatabase}
            needsConnectionEnv={needsConnectionEnv}
            connectionEnv={connectionEnv}
            onConnectionEnvChange={(v) => { setConnectionEnv(v); connectionEnvTouched.current = true; }}
            sqliteFile={sqliteFile}
            onSqliteFileChange={setSqliteFile}
            prismaSchema={prismaSchema}
            onPrismaSchemaChange={setPrismaSchema}
            aiProvider={aiProvider}
            onAiProviderChange={pickAiProvider}
            aiKeyEnv={aiKeyEnv}
            onAiKeyEnvChange={(v) => { setAiKeyEnv(v); aiKeyEnvTouched.current = true; }}
            aiModelEnv={aiModelEnv}
            onAiModelEnvChange={(v) => { setAiModelEnv(v); aiModelEnvTouched.current = true; }}
            schemaOut={schemaOut}
            onSchemaOutChange={setSchemaOut}
            ragStore={ragStore}
            onRagStoreChange={setRagStore}
            pgvectorEnv={pgvectorEnv}
            onPgvectorEnvChange={setPgvectorEnv}
            studioExecuteEnabled={studioExecuteEnabled}
            onStudioExecuteEnabledChange={(v) => { setStudioExecuteEnabled(v); studioExecuteEnabledTouched.current = true; }}
            studioExecuteProvider={studioExecuteProvider}
            onStudioExecuteProviderChange={pickStudioExecuteProvider}
            studioExecuteConnectionEnv={studioExecuteConnectionEnv}
            onStudioExecuteConnectionEnvChange={(v) => { setStudioExecuteConnectionEnv(v); studioExecuteConnectionEnvTouched.current = true; }}
            studioExecuteSqliteFile={studioExecuteSqliteFile}
            onStudioExecuteSqliteFileChange={setStudioExecuteSqliteFile}
            onWriteConfig={() => void handleWriteConfig()}
          />
        )}

        {configDone && <SecretsCard stepNumber={secretsStep} envVars={envVarsToFill} />}

        {configDone && (
          <IntrospectCard stepNumber={introspectStep} busy={busy} onIntrospect={() => void handleIntrospect()} />
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
