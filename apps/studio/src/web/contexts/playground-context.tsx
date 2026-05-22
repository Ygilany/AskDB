import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { TenantSqlOutputMode, TenantScope } from "@askdb/core";
import type { AskResponse, ExecuteResponse, PlaygroundHistoryEntry } from "@/shared/api";
import { ask, deleteFromHistory, executeQuery, getHistory, saveToHistory } from "../api";
import type { StatusMessage } from "./workspace-context";

interface PlaygroundContextValue {
  askQuestion: string;
  setAskQuestion: (q: string) => void;
  askMode: "full" | "rag";
  setAskMode: (m: "full" | "rag") => void;
  askMessage: StatusMessage | null;
  askResult: AskResponse | null;
  setAskResult: (r: AskResponse | null) => void;
  askTenantEnabled: boolean;
  setAskTenantEnabled: (v: boolean) => void;
  askTenantScopeJson: string;
  setAskTenantScopeJson: (v: string) => void;
  askTenantSqlMode: TenantSqlOutputMode;
  setAskTenantSqlMode: (v: TenantSqlOutputMode) => void;
  executeResult: ExecuteResponse | null;
  executeMessage: StatusMessage | null;
  historyEntries: PlaygroundHistoryEntry[];
  busy: Set<string>;

  handleAsk: () => Promise<void>;
  handleExecute: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  handleDeleteHistory: (id: string) => Promise<void>;
  loadHistoryEntry: (entry: PlaygroundHistoryEntry) => void;
}

const PlaygroundContext = createContext<PlaygroundContextValue | null>(null);

export function usePlayground(): PlaygroundContextValue {
  const ctx = useContext(PlaygroundContext);
  if (!ctx) throw new Error("usePlayground must be used within PlaygroundProvider");
  return ctx;
}

export function PlaygroundProvider({ children, ragAvailable }: { children: ReactNode; ragAvailable: boolean }) {
  const [askQuestion, setAskQuestion] = useState("");
  const [askMode, setAskMode] = useState<"full" | "rag">("full");
  const [askMessage, setAskMessage] = useState<StatusMessage | null>(null);
  const [askResult, setAskResult] = useState<AskResponse | null>(null);
  const [askTenantEnabled, setAskTenantEnabled] = useState(false);
  const [askTenantScopeJson, setAskTenantScopeJson] = useState("");
  const [askTenantSqlMode, setAskTenantSqlMode] = useState<TenantSqlOutputMode>("sql-only");
  const [executeResult, setExecuteResult] = useState<ExecuteResponse | null>(null);
  const [executeMessage, setExecuteMessage] = useState<StatusMessage | null>(null);
  const [historyEntries, setHistoryEntries] = useState<PlaygroundHistoryEntry[]>([]);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (askMessage?.kind === "success" || askMessage?.kind === "neutral") {
      const id = setTimeout(() => setAskMessage(null), 4000);
      return () => clearTimeout(id);
    }
  }, [askMessage]);

  useEffect(() => {
    if (!ragAvailable && askMode === "rag") {
      setAskMode("full");
    }
  }, [ragAvailable, askMode]);

  async function withBusy(key: string, task: () => Promise<void>) {
    setBusy((c) => new Set(c).add(key));
    try { await task(); } finally {
      setBusy((c) => { const n = new Set(c); n.delete(key); return n; });
    }
  }

  async function refreshHistory() {
    try {
      const h = await getHistory();
      setHistoryEntries(h.entries);
    } catch { /* silent */ }
  }

  async function handleAsk() {
    if (!askQuestion.trim()) {
      setAskMessage({ kind: "error", text: "Enter a question before generating SQL." });
      return;
    }
    let tenantScope: TenantScope | undefined;
    if (askTenantEnabled && askTenantScopeJson.trim()) {
      try {
        tenantScope = JSON.parse(askTenantScopeJson.trim()) as TenantScope;
      } catch {
        setAskMessage({ kind: "error", text: "Invalid tenant scope JSON." });
        return;
      }
    }
    setAskMessage({ kind: "loading", text: "Generating SQL..." });
    setAskResult(null);
    await withBusy("ask", async () => {
      try {
        const result = await ask({
          question: askQuestion.trim(),
          mode: askMode,
          ...(tenantScope ? { tenantScope, tenantSqlMode: askTenantSqlMode } : {}),
        });
        setAskResult(result);
        setAskMessage({ kind: "success", text: "Generated SQL." });
        void saveToHistory({
          question: askQuestion.trim(),
          mode: askMode,
          sql: result.sql,
          sqlMode: askTenantSqlMode,
          tenantScope: askTenantEnabled && askTenantScopeJson.trim() ? JSON.parse(askTenantScopeJson) as Record<string, unknown> : undefined,
          tenantParams: result.tenant?.params && result.tenant.params.length > 0
            ? Object.fromEntries(result.tenant.params.map((v, i) => [String(i + 1), v]))
            : undefined,
          explain: result.explain ?? undefined,
        }).then(() => void refreshHistory());
      } catch (error) {
        setAskMessage({ kind: "error", text: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  async function handleExecute() {
    if (!askResult?.sql) return;
    setExecuteMessage({ kind: "loading", text: "Executing query..." });
    await withBusy("execute", async () => {
      try {
        const params = askResult.tenant?.params ? (askResult.tenant.params as unknown[]) : [];
        const result = await executeQuery({ sql: askResult.sql, params });
        setExecuteResult(result);
        if (result.ok) {
          setExecuteMessage({
            kind: "success",
            text: `${result.rowCount ?? 0} rows${result.truncated ? " (truncated to 500)" : ""} · ${result.durationMs ?? 0}ms`,
          });
        } else {
          setExecuteMessage({ kind: "error", text: result.error ?? "Unknown error" });
        }
      } catch (err) {
        setExecuteMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  async function handleDeleteHistory(id: string) {
    await deleteFromHistory(id);
    await refreshHistory();
  }

  function loadHistoryEntry(entry: PlaygroundHistoryEntry) {
    setAskQuestion(entry.question);
    setAskMode(entry.mode as "full" | "rag");
    setAskResult({ sql: entry.sql, explain: entry.explain ?? null, warnings: [], rag: { enabled: false, chunks: [] }, tenant: null, usage: null } as AskResponse);
    setAskTenantSqlMode(entry.sqlMode as TenantSqlOutputMode);
    setExecuteResult(null);
  }

  const value: PlaygroundContextValue = {
    askQuestion, setAskQuestion, askMode, setAskMode, askMessage, askResult, setAskResult,
    askTenantEnabled, setAskTenantEnabled, askTenantScopeJson, setAskTenantScopeJson,
    askTenantSqlMode, setAskTenantSqlMode, executeResult, executeMessage, historyEntries, busy,
    handleAsk, handleExecute, refreshHistory, handleDeleteHistory, loadHistoryEntry,
  };

  return <PlaygroundContext.Provider value={value}>{children}</PlaygroundContext.Provider>;
}
