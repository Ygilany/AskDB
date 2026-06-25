import { createContext, useContext, useEffect, useMemo, useReducer } from "react";
import type { ReactNode } from "react";
import type { TenantFilterCondition, TenantSqlOutputMode, TenantScope } from "@askdb/core";
import type { AskResponse, ExecuteResponse, ExecuteStatusResponse, PlaygroundHistoryEntry } from "@/shared/api";
import { ask, deleteFromHistory, executeQuery, getExecuteStatus, getHistory, installExecuteDriver, saveToHistory } from "../api";
import type { StatusMessage } from "./workspace-context";
import { useWorkspace } from "./workspace-context";

export type TenantScopeAccessKind = "ids" | "subtree" | "multi_root" | "global";

export type TenantScopeContextDraft = {
  role: string;
  label: string;
  department: string;
  region: string;
  description: string;
};

export type TenantContextAttributeDraft = {
  id: string;
  key: string;
  value: string;
};

export type TenantMultiRootScopeDraft = {
  id: string;
  tenantRoot: string;
  idsText: string;
};

export type TenantFilterConditionDraft = {
  id: string;
  tableId: string;
  column: string;
  operator: TenantFilterCondition["operator"];
  valueText: string;
};

type GeneratedTenantScope = {
  scope?: TenantScope;
  error?: string;
  json: string;
};

type PlaygroundState = {
  askQuestion: string;
  askMode: "full" | "rag";
  askMessage: StatusMessage | null;
  askResult: AskResponse | null;
  askTenantSqlMode: TenantSqlOutputMode;
  executeResult: ExecuteResponse | null;
  executeMessage: StatusMessage | null;
  executeStatus: ExecuteStatusResponse | null;
  historyEntries: PlaygroundHistoryEntry[];
  busy: Set<string>;
};

type PlaygroundAction =
  | { type: "set_ask_question"; question: string }
  | { type: "set_ask_mode"; mode: "full" | "rag" }
  | { type: "set_ask_message"; message: StatusMessage | null }
  | { type: "set_ask_result"; result: AskResponse | null }
  | { type: "set_tenant_sql_mode"; mode: TenantSqlOutputMode }
  | { type: "set_execute_result"; result: ExecuteResponse | null }
  | { type: "set_execute_message"; message: StatusMessage | null }
  | { type: "set_execute_status"; status: ExecuteStatusResponse | null }
  | { type: "set_history_entries"; entries: PlaygroundHistoryEntry[] }
  | { type: "set_busy"; key: string; busy: boolean }
  | { type: "load_history_entry"; entry: PlaygroundHistoryEntry; sqlMode: TenantSqlOutputMode }
  | { type: "start_ask" }
  | { type: "ask_succeeded"; result: AskResponse }
  | { type: "execute_completed"; result: ExecuteResponse; message: StatusMessage };

const initialPlaygroundState: PlaygroundState = {
  askQuestion: "",
  askMode: "full",
  askMessage: null,
  askResult: null,
  askTenantSqlMode: "sql-only",
  executeResult: null,
  executeMessage: null,
  executeStatus: null,
  historyEntries: [],
  busy: new Set(),
};

type TenantScopeDraftState = {
  enabled: boolean;
  accessKind: TenantScopeAccessKind;
  tenantRoot: string;
  idsText: string;
  multiRootRows: TenantMultiRootScopeDraft[];
  globalReason: string;
  context: TenantScopeContextDraft;
  contextAttributes: TenantContextAttributeDraft[];
  filterRows: TenantFilterConditionDraft[];
};

type TenantScopeDraftAction =
  | { type: "set_enabled"; enabled: boolean }
  | { type: "set_access_kind"; accessKind: TenantScopeAccessKind }
  | { type: "set_tenant_root"; tenantRoot: string }
  | { type: "set_ids_text"; idsText: string }
  | { type: "set_multi_root_rows"; rows: TenantMultiRootScopeDraft[] }
  | { type: "set_global_reason"; globalReason: string }
  | { type: "set_context"; context: TenantScopeContextDraft }
  | { type: "set_context_attributes"; attributes: TenantContextAttributeDraft[] }
  | { type: "set_filter_rows"; rows: TenantFilterConditionDraft[] }
  | { type: "sync_policy"; firstRoot: string; rootIds: Set<string>; polymorphicIds: Set<string> }
  | { type: "disable" }
  | { type: "apply_scope"; scope: TenantScope };

const emptyTenantContext: TenantScopeContextDraft = {
  role: "",
  label: "",
  department: "",
  region: "",
  description: "",
};

const initialTenantScopeDraft: TenantScopeDraftState = {
  enabled: false,
  accessKind: "ids",
  tenantRoot: "",
  idsText: "",
  multiRootRows: [],
  globalReason: "superuser access",
  context: emptyTenantContext,
  contextAttributes: [],
  filterRows: [],
};

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
  askTenantAccessKind: TenantScopeAccessKind;
  setAskTenantAccessKind: (v: TenantScopeAccessKind) => void;
  askTenantRoot: string;
  setAskTenantRoot: (v: string) => void;
  askTenantIdsText: string;
  setAskTenantIdsText: (v: string) => void;
  askTenantMultiRootRows: TenantMultiRootScopeDraft[];
  setAskTenantMultiRootRows: (v: TenantMultiRootScopeDraft[]) => void;
  askTenantGlobalReason: string;
  setAskTenantGlobalReason: (v: string) => void;
  askTenantContext: TenantScopeContextDraft;
  setAskTenantContext: (v: TenantScopeContextDraft) => void;
  askTenantContextAttributes: TenantContextAttributeDraft[];
  setAskTenantContextAttributes: (v: TenantContextAttributeDraft[]) => void;
  askTenantFilterRows: TenantFilterConditionDraft[];
  setAskTenantFilterRows: (v: TenantFilterConditionDraft[]) => void;
  generatedTenantScope: TenantScope | undefined;
  generatedTenantScopeJson: string;
  tenantScopeValidationError: string | undefined;
  askTenantSqlMode: TenantSqlOutputMode;
  setAskTenantSqlMode: (v: TenantSqlOutputMode) => void;
  executeResult: ExecuteResponse | null;
  executeMessage: StatusMessage | null;
  executeStatus: ExecuteStatusResponse | null;
  historyEntries: PlaygroundHistoryEntry[];
  busy: Set<string>;

  handleAsk: () => Promise<void>;
  handleExecute: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  refreshExecuteStatus: () => Promise<void>;
  handleInstallExecuteDriver: () => Promise<void>;
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
  const { workspace } = useWorkspace();
  const [playgroundState, dispatchPlayground] = useReducer(playgroundReducer, initialPlaygroundState);
  const [tenantDraft, dispatchTenantDraft] = useReducer(tenantScopeDraftReducer, initialTenantScopeDraft);
  const tenantPolicy = workspace?.tenantPolicy ?? null;
  const tenantRootSignature = tenantPolicy?.roots.map((root) => root.id).join("|") ?? "";
  const polymorphicTableSignature = tenantPolicy?.polymorphicTables.map((table) => table.id).join("|") ?? "";
  const effectiveAskMode = ragAvailable ? playgroundState.askMode : "full";

  useEffect(() => {
    if (playgroundState.askMessage?.kind === "success" || playgroundState.askMessage?.kind === "neutral") {
      const id = setTimeout(() => dispatchPlayground({ type: "set_ask_message", message: null }), 4000);
      return () => clearTimeout(id);
    }
  }, [playgroundState.askMessage]);

  useEffect(() => {
    if (!tenantPolicy) {
      dispatchTenantDraft({ type: "disable" });
      return;
    }

    const firstRoot = tenantPolicy.roots[0]?.id ?? "";
    const rootIds = new Set(tenantPolicy.roots.map((root) => root.id));
    const polymorphicIds = new Set(tenantPolicy.polymorphicTables.map((table) => table.id));

    dispatchTenantDraft({ type: "sync_policy", firstRoot, rootIds, polymorphicIds });
  }, [tenantPolicy, tenantRootSignature, polymorphicTableSignature]);

  const generatedTenantScopeState = useMemo<GeneratedTenantScope>(() => {
    if (!tenantDraft.enabled || !tenantPolicy) {
      return { json: "" };
    }

    const result = buildTenantScope({
      accessKind: tenantDraft.accessKind,
      tenantRoot: tenantDraft.tenantRoot,
      idsText: tenantDraft.idsText,
      multiRootRows: tenantDraft.multiRootRows,
      globalReason: tenantDraft.globalReason,
      context: tenantDraft.context,
      contextAttributes: tenantDraft.contextAttributes,
      filterRows: tenantDraft.filterRows,
    });

    return {
      ...result,
      json: result.scope ? JSON.stringify(result.scope, null, 2) : "",
    };
  }, [
    tenantDraft,
    tenantPolicy,
  ]);

  async function withBusy(key: string, task: () => Promise<void>) {
    dispatchPlayground({ type: "set_busy", key, busy: true });
    try { await task(); } finally {
      dispatchPlayground({ type: "set_busy", key, busy: false });
    }
  }

  async function refreshHistory() {
    try {
      const h = await getHistory();
      dispatchPlayground({ type: "set_history_entries", entries: h.entries });
    } catch { /* silent */ }
  }

  async function refreshExecuteStatus() {
    try {
      const status = await getExecuteStatus();
      dispatchPlayground({ type: "set_execute_status", status });
    } catch { /* silent — status is advisory */ }
  }

  async function handleInstallExecuteDriver() {
    await withBusy("install-driver", async () => {
      try {
        const result = await installExecuteDriver({});
        if (result.ok || result.installed) {
          dispatchPlayground({ type: "set_execute_message", message: { kind: "success", text: `Installed ${result.packageName}. Ready to execute.` } });
        } else {
          dispatchPlayground({ type: "set_execute_message", message: { kind: "error", text: result.error ?? `Failed to install ${result.packageName}.` } });
        }
        await refreshExecuteStatus();
      } catch (err) {
        dispatchPlayground({ type: "set_execute_message", message: { kind: "error", text: err instanceof Error ? err.message : String(err) } });
      }
    });
  }

  useEffect(() => {
    void refreshExecuteStatus();
  }, []); // intentionally empty — load once on mount

  async function handleAsk() {
    if (!playgroundState.askQuestion.trim()) {
      dispatchPlayground({ type: "set_ask_message", message: { kind: "error", text: "Enter a question before generating SQL." } });
      return;
    }
    const tenantScope = tenantDraft.enabled ? generatedTenantScopeState.scope : undefined;
    if (tenantDraft.enabled && generatedTenantScopeState.error) {
      dispatchPlayground({ type: "set_ask_message", message: { kind: "error", text: generatedTenantScopeState.error } });
      return;
    }
    dispatchPlayground({ type: "start_ask" });
    await withBusy("ask", async () => {
      try {
        const result = await ask({
          question: playgroundState.askQuestion.trim(),
          mode: effectiveAskMode,
          ...(tenantScope ? { tenantScope, tenantSqlMode: playgroundState.askTenantSqlMode } : {}),
        });
        dispatchPlayground({ type: "ask_succeeded", result });
        void saveToHistory({
          question: playgroundState.askQuestion.trim(),
          mode: effectiveAskMode,
          sql: result.sql,
          sqlMode: playgroundState.askTenantSqlMode,
          tenantScope: tenantScope as Record<string, unknown> | undefined,
          tenantParams: result.tenant?.params && result.tenant.params.length > 0
            ? Object.fromEntries(result.tenant.params.map((v, i) => [String(i + 1), v]))
            : undefined,
          explain: result.explain ?? undefined,
        }).then(() => void refreshHistory());
      } catch (error) {
        dispatchPlayground({ type: "set_ask_message", message: { kind: "error", text: error instanceof Error ? error.message : String(error) } });
      }
    });
  }

  async function handleExecute() {
    if (!playgroundState.askResult?.sql) return;
    dispatchPlayground({ type: "set_execute_message", message: { kind: "loading", text: "Executing query..." } });
    await withBusy("execute", async () => {
      try {
        const params = playgroundState.askResult?.tenant?.params ? (playgroundState.askResult.tenant.params as unknown[]) : [];
        const result = await executeQuery({ sql: playgroundState.askResult!.sql, params });
        dispatchPlayground({
          type: "execute_completed",
          result,
          message: result.ok
            ? { kind: "success", text: `${result.rowCount ?? 0} rows${result.truncated ? " (truncated to 500)" : ""} · ${result.durationMs ?? 0}ms` }
            : { kind: "error", text: result.error ?? "Unknown error" },
        });
      } catch (err) {
        dispatchPlayground({ type: "set_execute_message", message: { kind: "error", text: err instanceof Error ? err.message : String(err) } });
      }
    });
  }

  async function handleDeleteHistory(id: string) {
    await deleteFromHistory(id);
    await refreshHistory();
  }

  function loadHistoryEntry(entry: PlaygroundHistoryEntry) {
    dispatchPlayground({ type: "load_history_entry", entry, sqlMode: entry.sqlMode as TenantSqlOutputMode });
    applyTenantScopeDraft(entry.tenantScope);
  }

  const value: PlaygroundContextValue = {
    askQuestion: playgroundState.askQuestion,
    setAskQuestion: (question) => dispatchPlayground({ type: "set_ask_question", question }),
    askMode: effectiveAskMode,
    setAskMode: (mode) => dispatchPlayground({ type: "set_ask_mode", mode }),
    askMessage: playgroundState.askMessage,
    askResult: playgroundState.askResult,
    setAskResult: (result) => dispatchPlayground({ type: "set_ask_result", result }),
    askTenantEnabled: tenantDraft.enabled,
    setAskTenantEnabled: (enabled) => dispatchTenantDraft({ type: "set_enabled", enabled }),
    askTenantAccessKind: tenantDraft.accessKind,
    setAskTenantAccessKind: (accessKind) => dispatchTenantDraft({ type: "set_access_kind", accessKind }),
    askTenantRoot: tenantDraft.tenantRoot,
    setAskTenantRoot: (tenantRoot) => dispatchTenantDraft({ type: "set_tenant_root", tenantRoot }),
    askTenantIdsText: tenantDraft.idsText,
    setAskTenantIdsText: (idsText) => dispatchTenantDraft({ type: "set_ids_text", idsText }),
    askTenantMultiRootRows: tenantDraft.multiRootRows,
    setAskTenantMultiRootRows: (rows) => dispatchTenantDraft({ type: "set_multi_root_rows", rows }),
    askTenantGlobalReason: tenantDraft.globalReason,
    setAskTenantGlobalReason: (globalReason) => dispatchTenantDraft({ type: "set_global_reason", globalReason }),
    askTenantContext: tenantDraft.context,
    setAskTenantContext: (context) => dispatchTenantDraft({ type: "set_context", context }),
    askTenantContextAttributes: tenantDraft.contextAttributes,
    setAskTenantContextAttributes: (attributes) => dispatchTenantDraft({ type: "set_context_attributes", attributes }),
    askTenantFilterRows: tenantDraft.filterRows,
    setAskTenantFilterRows: (rows) => dispatchTenantDraft({ type: "set_filter_rows", rows }),
    generatedTenantScope: generatedTenantScopeState.scope,
    generatedTenantScopeJson: generatedTenantScopeState.json,
    tenantScopeValidationError: generatedTenantScopeState.error,
    askTenantSqlMode: playgroundState.askTenantSqlMode,
    setAskTenantSqlMode: (mode) => dispatchPlayground({ type: "set_tenant_sql_mode", mode }),
    executeResult: playgroundState.executeResult,
    executeMessage: playgroundState.executeMessage,
    executeStatus: playgroundState.executeStatus,
    historyEntries: playgroundState.historyEntries,
    busy: playgroundState.busy,
    handleAsk, handleExecute, refreshHistory, refreshExecuteStatus, handleInstallExecuteDriver, handleDeleteHistory, loadHistoryEntry,
  };

  return <PlaygroundContext.Provider value={value}>{children}</PlaygroundContext.Provider>;

  function applyTenantScopeDraft(candidate: unknown) {
    if (!candidate || typeof candidate !== "object") {
      dispatchTenantDraft({ type: "disable" });
      return;
    }

    const scope = candidate as TenantScope;
    if (!scope.access || typeof scope.access !== "object") return;

    dispatchTenantDraft({ type: "apply_scope", scope });
  }
}

function makeDraftId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function playgroundReducer(state: PlaygroundState, action: PlaygroundAction): PlaygroundState {
  switch (action.type) {
    case "set_ask_question":
      return { ...state, askQuestion: action.question };
    case "set_ask_mode":
      return { ...state, askMode: action.mode };
    case "set_ask_message":
      return { ...state, askMessage: action.message };
    case "set_ask_result":
      return { ...state, askResult: action.result };
    case "set_tenant_sql_mode":
      return { ...state, askTenantSqlMode: action.mode };
    case "set_execute_result":
      return { ...state, executeResult: action.result };
    case "set_execute_message":
      return { ...state, executeMessage: action.message };
    case "set_execute_status":
      return { ...state, executeStatus: action.status };
    case "set_history_entries":
      return { ...state, historyEntries: action.entries };
    case "set_busy": {
      const busy = new Set(state.busy);
      if (action.busy) {
        busy.add(action.key);
      } else {
        busy.delete(action.key);
      }
      return { ...state, busy };
    }
    case "start_ask":
      return { ...state, askMessage: { kind: "loading", text: "Generating SQL..." }, askResult: null, executeResult: null, executeMessage: null };
    case "ask_succeeded":
      return { ...state, askResult: action.result, askMessage: { kind: "success", text: "Generated SQL." } };
    case "execute_completed":
      return { ...state, executeResult: action.result, executeMessage: action.message };
    case "load_history_entry":
      return {
        ...state,
        askQuestion: action.entry.question,
        askMode: action.entry.mode as "full" | "rag",
        askResult: {
          sql: action.entry.sql,
          explain: action.entry.explain ?? null,
          warnings: [],
          rag: { enabled: false, chunks: [] },
          tenant: null,
          usage: null,
        } as AskResponse,
        askTenantSqlMode: action.sqlMode,
        executeResult: null,
      };
  }
}

function tenantScopeDraftReducer(
  state: TenantScopeDraftState,
  action: TenantScopeDraftAction,
): TenantScopeDraftState {
  switch (action.type) {
    case "set_enabled":
      return { ...state, enabled: action.enabled };
    case "set_access_kind":
      return { ...state, accessKind: action.accessKind };
    case "set_tenant_root":
      return { ...state, tenantRoot: action.tenantRoot };
    case "set_ids_text":
      return { ...state, idsText: action.idsText };
    case "set_multi_root_rows":
      return { ...state, multiRootRows: action.rows };
    case "set_global_reason":
      return { ...state, globalReason: action.globalReason };
    case "set_context":
      return { ...state, context: action.context };
    case "set_context_attributes":
      return { ...state, contextAttributes: action.attributes };
    case "set_filter_rows":
      return { ...state, filterRows: action.rows };
    case "disable":
      return { ...state, enabled: false };
    case "sync_policy": {
      const multiRootRows = state.multiRootRows.length === 0
        ? action.firstRoot ? [{ id: makeDraftId("multi-root"), tenantRoot: action.firstRoot, idsText: "" }] : []
        : state.multiRootRows.map((row) => ({
          ...row,
          tenantRoot: action.rootIds.has(row.tenantRoot) ? row.tenantRoot : action.firstRoot,
        }));

      return {
        ...state,
        enabled: true,
        tenantRoot: action.rootIds.has(state.tenantRoot) ? state.tenantRoot : action.firstRoot,
        multiRootRows,
        filterRows: state.filterRows.filter((row) => action.polymorphicIds.has(row.tableId)),
      };
    }
    case "apply_scope": {
      const scope = action.scope;
      const next: TenantScopeDraftState = {
        ...state,
        enabled: true,
        context: {
          role: scope.context?.role ?? "",
          label: scope.context?.label ?? "",
          department: scope.context?.department ?? "",
          region: scope.context?.region ?? "",
          description: scope.context?.description ?? "",
        },
        contextAttributes: Object.entries(scope.context?.attributes ?? {}).map(([key, value]) => ({
          id: makeDraftId("context-attribute"),
          key,
          value,
        })),
        filterRows: Object.entries(scope.tenantFilters ?? {}).flatMap(([tableId, filter]) => (
          filter.conditions.map((condition) => ({
            id: makeDraftId("tenant-filter"),
            tableId,
            column: condition.column,
            operator: condition.operator,
            valueText: Array.isArray(condition.value) ? condition.value.join(", ") : condition.value,
          }))
        )),
      };

      switch (scope.access.kind) {
        case "ids":
          return {
            ...next,
            accessKind: "ids",
            tenantRoot: scope.access.tenantRoot,
            idsText: scope.access.ids.join(", "),
          };
        case "subtree":
          return {
            ...next,
            accessKind: "subtree",
            tenantRoot: scope.access.tenantRoot,
            idsText: scope.access.rootIds.join(", "),
          };
        case "multi_root":
          return {
            ...next,
            accessKind: "multi_root",
            multiRootRows: scope.access.scopes.map((row) => ({
              id: makeDraftId("multi-root"),
              tenantRoot: row.tenantRoot,
              idsText: row.ids.join(", "),
            })),
          };
        case "global":
          return {
            ...next,
            accessKind: "global",
            globalReason: scope.access.reason,
          };
      }
    }
  }
}

function parseList(value: string): string[] {
  return value.split(",").flatMap((item) => {
    const trimmed = item.trim();
    return trimmed ? [trimmed] : [];
  });
}

function buildTenantScope({
  accessKind,
  tenantRoot,
  idsText,
  multiRootRows,
  globalReason,
  context,
  contextAttributes,
  filterRows,
}: {
  accessKind: TenantScopeAccessKind;
  tenantRoot: string;
  idsText: string;
  multiRootRows: TenantMultiRootScopeDraft[];
  globalReason: string;
  context: TenantScopeContextDraft;
  contextAttributes: TenantContextAttributeDraft[];
  filterRows: TenantFilterConditionDraft[];
}): Pick<GeneratedTenantScope, "scope" | "error"> {
  const trimmedRoot = tenantRoot.trim();
  const ids = parseList(idsText);
  let access: TenantScope["access"];

  if (accessKind === "ids") {
    if (!trimmedRoot) return { error: "Choose a tenant root for the ids scope." };
    if (ids.length === 0) return { error: "Enter at least one tenant ID." };
    access = { kind: "ids", tenantRoot: trimmedRoot, ids };
  } else if (accessKind === "subtree") {
    if (!trimmedRoot) return { error: "Choose a tenant root for the subtree scope." };
    if (ids.length === 0) return { error: "Enter at least one subtree root ID." };
    access = { kind: "subtree", tenantRoot: trimmedRoot, rootIds: ids, includeDescendants: true };
  } else if (accessKind === "multi_root") {
    const scopes = multiRootRows.flatMap((row) => {
      const scope = { tenantRoot: row.tenantRoot.trim(), ids: parseList(row.idsText) };
      return scope.tenantRoot || scope.ids.length > 0 ? [scope] : [];
    });

    if (scopes.length === 0) return { error: "Add at least one multi-root scope row." };
    if (scopes.some((row) => !row.tenantRoot || row.ids.length === 0)) {
      return { error: "Each multi-root row needs a tenant root and at least one ID." };
    }
    access = { kind: "multi_root", scopes };
  } else {
    const reason = globalReason.trim();
    if (!reason) return { error: "Enter a reason for super / global access." };
    access = { kind: "global", reason };
  }

  const hasIncompleteAttribute = contextAttributes.some((attribute) => {
    const key = attribute.key.trim();
    const value = attribute.value.trim();
    return (key || value) && (!key || !value);
  });
  if (hasIncompleteAttribute) {
    return { error: "Each context attribute needs both a key and value." };
  }

  const tenantScope: TenantScope = { access };
  const contextValue = buildContext(context, contextAttributes);
  if (contextValue) tenantScope.context = contextValue;

  const tenantFilters = buildTenantFilters(filterRows);
  if ("error" in tenantFilters) return { error: tenantFilters.error };
  if (tenantFilters.value) tenantScope.tenantFilters = tenantFilters.value;

  return { scope: tenantScope };
}

function buildContext(
  context: TenantScopeContextDraft,
  attributes: TenantContextAttributeDraft[],
): TenantScope["context"] | undefined {
  const output: NonNullable<TenantScope["context"]> = {};
  if (context.role.trim()) output.role = context.role.trim();
  if (context.label.trim()) output.label = context.label.trim();
  if (context.department.trim()) output.department = context.department.trim();
  if (context.region.trim()) output.region = context.region.trim();
  if (context.description.trim()) output.description = context.description.trim();

  const attributeEntries = attributes.flatMap((attribute) => {
    const entry = [attribute.key.trim(), attribute.value.trim()] as const;
    return entry[0] || entry[1] ? [entry] : [];
  });

  if (attributeEntries.length > 0) {
    output.attributes = Object.fromEntries(attributeEntries);
  }

  return Object.keys(output).length > 0 ? output : undefined;
}

function buildTenantFilters(
  rows: TenantFilterConditionDraft[],
): { value?: NonNullable<TenantScope["tenantFilters"]> } | { error: string } {
  const tenantFilters: NonNullable<TenantScope["tenantFilters"]> = {};
  let hasActiveRows = false;

  for (const row of rows) {
    const tableId = row.tableId.trim();
    const column = row.column.trim();
    const valueText = row.valueText.trim();

    if (!tableId && !column && !valueText) continue;
    hasActiveRows = true;

    if (!tableId || !column || !valueText) {
      return { error: "Each tenant filter condition needs a table, column, operator, and value." };
    }

    const condition: TenantFilterCondition = {
      column,
      operator: row.operator,
      value: row.operator === "IN" || row.operator === "NOT IN"
        ? parseList(valueText)
        : valueText,
    };
    if (Array.isArray(condition.value) && condition.value.length === 0) {
      return { error: "Tenant filter IN conditions need at least one value." };
    }

    tenantFilters[tableId] ??= { conditions: [] };
    tenantFilters[tableId].conditions.push(condition);
  }

  return hasActiveRows ? { value: tenantFilters } : {};
}
