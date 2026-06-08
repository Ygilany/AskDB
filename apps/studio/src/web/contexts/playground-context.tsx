import { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from "react";
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

type PlaygroundState = {
  askQuestion: string;
  askMode: "full" | "rag";
  askMessage: StatusMessage | null;
  askResult: AskResponse | null;
  askTenantEnabled: boolean;
  askTenantScopeJson: string;
  askTenantSqlMode: TenantSqlOutputMode;
  executeResult: ExecuteResponse | null;
  executeMessage: StatusMessage | null;
  historyEntries: PlaygroundHistoryEntry[];
  busy: Set<string>;
};

type PlaygroundAction =
  | { type: "set_askQuestion"; payload: string }
  | { type: "set_askMode"; payload: "full" | "rag" }
  | { type: "set_askMessage"; payload: StatusMessage | null }
  | { type: "set_askResult"; payload: AskResponse | null }
  | { type: "set_askTenantEnabled"; payload: boolean }
  | { type: "set_askTenantScopeJson"; payload: string }
  | { type: "set_askTenantSqlMode"; payload: TenantSqlOutputMode }
  | { type: "set_executeResult"; payload: ExecuteResponse | null }
  | { type: "set_executeMessage"; payload: StatusMessage | null }
  | { type: "set_historyEntries"; payload: PlaygroundHistoryEntry[] }
  | { type: "busy_add"; key: string }
  | { type: "busy_remove"; key: string }
  | { type: "load_history_entry"; entry: PlaygroundHistoryEntry };

function playgroundReducer(state: PlaygroundState, action: PlaygroundAction): PlaygroundState {
  switch (action.type) {
    case "set_askQuestion": return { ...state, askQuestion: action.payload };
    case "set_askMode": return { ...state, askMode: action.payload };
    case "set_askMessage": return { ...state, askMessage: action.payload };
    case "set_askResult": return { ...state, askResult: action.payload };
    case "set_askTenantEnabled": return { ...state, askTenantEnabled: action.payload };
    case "set_askTenantScopeJson": return { ...state, askTenantScopeJson: action.payload };
    case "set_askTenantSqlMode": return { ...state, askTenantSqlMode: action.payload };
    case "set_executeResult": return { ...state, executeResult: action.payload };
    case "set_executeMessage": return { ...state, executeMessage: action.payload };
    case "set_historyEntries": return { ...state, historyEntries: action.payload };
    case "busy_add": { const s = new Set(state.busy); s.add(action.key); return { ...state, busy: s }; }
    case "busy_remove": { const s = new Set(state.busy); s.delete(action.key); return { ...state, busy: s }; }
    case "load_history_entry": {
      const { entry } = action;
      return {
        ...state,
        askQuestion: entry.question,
        askMode: entry.mode as "full" | "rag",
        askResult: { sql: entry.sql, explain: entry.explain ?? null, warnings: [], rag: { enabled: false, chunks: [] }, tenant: null, usage: null } as AskResponse,
        askTenantSqlMode: entry.sqlMode as TenantSqlOutputMode,
        executeResult: null,
      };
    }
  }
}

const initialPlaygroundState: PlaygroundState = {
  askQuestion: "",
  askMode: "full",
  askMessage: null,
  askResult: null,
  askTenantEnabled: false,
  askTenantScopeJson: "",
  askTenantSqlMode: "sql-only",
  executeResult: null,
  executeMessage: null,
  historyEntries: [],
  busy: new Set(),
};

export function PlaygroundProvider({ children, ragAvailable }: { children: ReactNode; ragAvailable: boolean }) {
  const [state, dispatch] = useReducer(playgroundReducer, initialPlaygroundState);
  const {
    askQuestion, askMode, askMessage, askResult,
    askTenantEnabled, askTenantScopeJson, askTenantSqlMode,
    executeResult, executeMessage, historyEntries, busy,
  } = state;
  const effectiveAskMode = ragAvailable ? askMode : "full";

  const setAskQuestion = useCallback((v: string) => dispatch({ type: "set_askQuestion", payload: v }), []);
  const setAskMode = useCallback((v: "full" | "rag") => {
    dispatch({ type: "set_askMode", payload: v === "rag" && !ragAvailable ? "full" : v });
  }, [ragAvailable]);
  const setAskMessage = useCallback((v: StatusMessage | null) => dispatch({ type: "set_askMessage", payload: v }), []);
  const setAskResult = useCallback((v: AskResponse | null) => dispatch({ type: "set_askResult", payload: v }), []);
  const setAskTenantEnabled = useCallback((v: boolean) => dispatch({ type: "set_askTenantEnabled", payload: v }), []);
  const setAskTenantScopeJson = useCallback((v: string) => dispatch({ type: "set_askTenantScopeJson", payload: v }), []);
  const setAskTenantSqlMode = useCallback((v: TenantSqlOutputMode) => dispatch({ type: "set_askTenantSqlMode", payload: v }), []);
  const setExecuteResult = useCallback((v: ExecuteResponse | null) => dispatch({ type: "set_executeResult", payload: v }), []);
  const setExecuteMessage = useCallback((v: StatusMessage | null) => dispatch({ type: "set_executeMessage", payload: v }), []);
  const setHistoryEntries = useCallback((v: PlaygroundHistoryEntry[]) => dispatch({ type: "set_historyEntries", payload: v }), []);

  useEffect(() => {
    if (askMessage?.kind === "success" || askMessage?.kind === "neutral") {
      const id = setTimeout(() => setAskMessage(null), 4000);
      return () => clearTimeout(id);
    }
  }, [askMessage, setAskMessage]);

  const withBusy = useCallback(async (key: string, task: () => Promise<void>) => {
    dispatch({ type: "busy_add", key });
    try { await task(); } finally {
      dispatch({ type: "busy_remove", key });
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const h = await getHistory();
      setHistoryEntries(h.entries);
    } catch { /* silent */ }
  }, [setHistoryEntries]);

  const handleAsk = useCallback(async () => {
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
          mode: effectiveAskMode,
          ...(tenantScope ? { tenantScope, tenantSqlMode: askTenantSqlMode } : {}),
        });
        setAskResult(result);
        setAskMessage({ kind: "success", text: "Generated SQL." });
        void saveToHistory({
          question: askQuestion.trim(),
          mode: effectiveAskMode,
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
  }, [
    askQuestion, askTenantEnabled, askTenantScopeJson, askTenantSqlMode, effectiveAskMode,
    refreshHistory, setAskMessage, setAskResult, withBusy,
  ]);

  const handleExecute = useCallback(async () => {
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
  }, [askResult, setExecuteMessage, setExecuteResult, withBusy]);

  const handleDeleteHistory = useCallback(async (id: string) => {
    await deleteFromHistory(id);
    await refreshHistory();
  }, [refreshHistory]);

  const loadHistoryEntry = useCallback((entry: PlaygroundHistoryEntry) => {
    dispatch({ type: "load_history_entry", entry });
  }, []);

  const value = useMemo<PlaygroundContextValue>(() => ({
    askQuestion, setAskQuestion, askMode: effectiveAskMode, setAskMode, askMessage, askResult, setAskResult,
    askTenantEnabled, setAskTenantEnabled, askTenantScopeJson, setAskTenantScopeJson,
    askTenantSqlMode, setAskTenantSqlMode, executeResult, executeMessage, historyEntries, busy,
    handleAsk, handleExecute, refreshHistory, handleDeleteHistory, loadHistoryEntry,
  }), [
    askMessage, askQuestion, askResult, askTenantEnabled, askTenantScopeJson,
    askTenantSqlMode, busy, executeMessage, executeResult, handleAsk,
    handleDeleteHistory, handleExecute, historyEntries, effectiveAskMode, loadHistoryEntry,
    refreshHistory, setAskMode, setAskQuestion, setAskResult, setAskTenantEnabled,
    setAskTenantScopeJson, setAskTenantSqlMode,
  ]);

  return <PlaygroundContext.Provider value={value}>{children}</PlaygroundContext.Provider>;
}
