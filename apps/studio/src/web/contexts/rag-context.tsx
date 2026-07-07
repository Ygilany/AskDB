import { createContext, use, useCallback, useEffect, useEffectEvent, useMemo, useReducer } from "react";
import type { ReactNode } from "react";
import type { ChunkType } from "@askdb/rag";
import type { RagQueryResponse, StudioRagStatusDto, StudioRequestUsageDto } from "@/shared/api";
import { buildRagIndex, getRagStatus, queryRag } from "../api";
import { formatNumber } from "../lib/format";
import type { StatusMessage } from "./workspace-context";

const CHUNK_TYPES: ChunkType[] = ["table", "column", "cql", "question", "concept", "relationship", "tenant-policy"];

interface RagContextValue {
  ragStatus: StudioRagStatusDto | null;
  ragMessage: StatusMessage | null;
  ragQuestion: string;
  setRagQuestion: (q: string) => void;
  ragK: number;
  setRagK: (k: number) => void;
  ragTypes: ChunkType[];
  setRagTypes: (t: ChunkType[]) => void;
  ragResults: RagQueryResponse | null;
  ragIndexUsage: StudioRequestUsageDto | null;
  ragAvailable: boolean;
  busy: Set<string>;
  allChunkTypes: ChunkType[];

  refreshRagStatus: () => Promise<void>;
  handleBuildRag: () => Promise<void>;
  handleQueryRag: () => Promise<void>;
}

const RagContext = createContext<RagContextValue | null>(null);

export function useRag(): RagContextValue {
  const ctx = use(RagContext);
  if (!ctx) throw new Error("useRag must be used within RagProvider");
  return ctx;
}

type RagState = {
  ragStatus: StudioRagStatusDto | null;
  ragMessage: StatusMessage | null;
  ragQuestion: string;
  ragK: number;
  ragTypes: ChunkType[];
  ragResults: RagQueryResponse | null;
  ragIndexUsage: StudioRequestUsageDto | null;
  busy: Set<string>;
};

type RagAction =
  | { type: "set_ragStatus"; payload: StudioRagStatusDto | null }
  | { type: "set_ragMessage"; payload: StatusMessage | null }
  | { type: "set_ragQuestion"; payload: string }
  | { type: "set_ragK"; payload: number }
  | { type: "set_ragTypes"; payload: ChunkType[] }
  | { type: "set_ragResults"; payload: RagQueryResponse | null }
  | { type: "set_ragIndexUsage"; payload: StudioRequestUsageDto | null }
  | { type: "busy_add"; key: string }
  | { type: "busy_remove"; key: string }
  | { type: "rag_build_completed"; status: StudioRagStatusDto | null; usage: StudioRequestUsageDto | null; message: StatusMessage }
  | { type: "rag_query_completed"; results: RagQueryResponse; message: StatusMessage };

function ragReducer(state: RagState, action: RagAction): RagState {
  switch (action.type) {
    case "set_ragStatus": return { ...state, ragStatus: action.payload };
    case "set_ragMessage": return { ...state, ragMessage: action.payload };
    case "set_ragQuestion": return { ...state, ragQuestion: action.payload };
    case "set_ragK": return { ...state, ragK: action.payload };
    case "set_ragTypes": return { ...state, ragTypes: action.payload };
    case "set_ragResults": return { ...state, ragResults: action.payload };
    case "set_ragIndexUsage": return { ...state, ragIndexUsage: action.payload };
    case "busy_add": { const s = new Set(state.busy); s.add(action.key); return { ...state, busy: s }; }
    case "busy_remove": { const s = new Set(state.busy); s.delete(action.key); return { ...state, busy: s }; }
    case "rag_build_completed": return { ...state, ragStatus: action.status, ragIndexUsage: action.usage, ragMessage: action.message };
    case "rag_query_completed": return { ...state, ragResults: action.results, ragMessage: action.message };
  }
}

const initialRagState: RagState = {
  ragStatus: null,
  ragMessage: null,
  ragQuestion: "",
  ragK: 8,
  ragTypes: ["table", "column", "cql", "question", "concept"],
  ragResults: null,
  ragIndexUsage: null,
  busy: new Set(),
};

export function RagProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(ragReducer, initialRagState);
  const { ragStatus, ragMessage, ragQuestion, ragK, ragTypes, ragResults, ragIndexUsage, busy } = state;

  const setRagStatus = useCallback((v: StudioRagStatusDto | null) => dispatch({ type: "set_ragStatus", payload: v }), []);
  const setRagMessage = useCallback((v: StatusMessage | null) => dispatch({ type: "set_ragMessage", payload: v }), []);
  const setRagQuestion = useCallback((v: string) => dispatch({ type: "set_ragQuestion", payload: v }), []);
  const setRagK = useCallback((v: number) => dispatch({ type: "set_ragK", payload: v }), []);
  const setRagTypes = useCallback((v: ChunkType[]) => dispatch({ type: "set_ragTypes", payload: v }), []);
  const setRagResults = useCallback((v: RagQueryResponse | null) => dispatch({ type: "set_ragResults", payload: v }), []);

  const ragAvailable = Boolean(ragStatus?.hasIndex);

  const clearRagMessage = useEffectEvent(() => setRagMessage(null));

  useEffect(() => {
    if (ragMessage?.kind === "success" || ragMessage?.kind === "neutral") {
      const id = setTimeout(() => clearRagMessage(), 4000);
      return () => clearTimeout(id);
    }
  }, [ragMessage]);

  const withBusy = useCallback(async (key: string, task: () => Promise<void>) => {
    dispatch({ type: "busy_add", key });
    try { await task(); } finally {
      dispatch({ type: "busy_remove", key });
    }
  }, []);

  const refreshRagStatus = useCallback(async () => {
    try {
      setRagStatus(await getRagStatus());
    } catch (error) {
      setRagMessage({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }, [setRagMessage, setRagStatus]);

  const handleBuildRag = useCallback(async () => {
    setRagMessage({ kind: "loading", text: "Indexing schema chunks..." });
    setRagResults(null);
    await withBusy("rag-build", async () => {
      try {
        const result = await buildRagIndex();
        const tokens = result.usage?.totalTokens ?? result.usage?.embeddingTokens ?? null;
        const tokenStr = tokens === null ? "" : `, ${formatNumber(tokens)} tokens`;
        dispatch({
          type: "rag_build_completed",
          status: result.status,
          usage: result.usage,
          message: { kind: "success", text: `Indexed ${result.stats.chunksIndexed ?? 0} chunks, reused ${result.stats.chunksReused ?? 0}${tokenStr}.` },
        });
      } catch (error) {
        setRagMessage({ kind: "error", text: error instanceof Error ? error.message : String(error) });
      }
    });
  }, [setRagMessage, setRagResults, withBusy]);

  const handleQueryRag = useCallback(async () => {
    if (!ragQuestion.trim()) {
      setRagMessage({ kind: "error", text: "Enter a question before querying RAG." });
      return;
    }
    setRagMessage({ kind: "loading", text: "Retrieving chunks..." });
    await withBusy("rag-query", async () => {
      try {
        const result = await queryRag({ question: ragQuestion.trim(), k: ragK, types: ragTypes });
        dispatch({ type: "rag_query_completed", results: result, message: { kind: "success", text: `Retrieved ${result.results.length} chunks.` } });
      } catch (error) {
        setRagMessage({ kind: "error", text: error instanceof Error ? error.message : String(error) });
      }
    });
  }, [ragK, ragQuestion, ragTypes, setRagMessage, withBusy]);

  const value = useMemo<RagContextValue>(() => ({
    ragStatus, ragMessage, ragQuestion, setRagQuestion, ragK, setRagK,
    ragTypes, setRagTypes, ragResults, ragIndexUsage, ragAvailable, busy,
    allChunkTypes: CHUNK_TYPES,
    refreshRagStatus, handleBuildRag, handleQueryRag,
  }), [
    busy, handleBuildRag, handleQueryRag, ragAvailable, ragIndexUsage, ragK,
    ragMessage, ragQuestion, ragResults, ragStatus, ragTypes, refreshRagStatus,
    setRagK, setRagQuestion, setRagTypes,
  ]);

  return <RagContext.Provider value={value}>{children}</RagContext.Provider>;
}
