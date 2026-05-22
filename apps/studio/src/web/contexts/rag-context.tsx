import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ChunkType } from "@askdb/rag";
import type { RagQueryResponse, StudioRagStatusDto, StudioRequestUsageDto } from "@/shared/api";
import { buildRagIndex, getRagStatus, queryRag } from "../api";
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
  const ctx = useContext(RagContext);
  if (!ctx) throw new Error("useRag must be used within RagProvider");
  return ctx;
}

export function RagProvider({ children }: { children: ReactNode }) {
  const [ragStatus, setRagStatus] = useState<StudioRagStatusDto | null>(null);
  const [ragMessage, setRagMessage] = useState<StatusMessage | null>(null);
  const [ragQuestion, setRagQuestion] = useState("");
  const [ragK, setRagK] = useState(8);
  const [ragTypes, setRagTypes] = useState<ChunkType[]>(["table", "column", "cql", "question", "concept"]);
  const [ragResults, setRagResults] = useState<RagQueryResponse | null>(null);
  const [ragIndexUsage, setRagIndexUsage] = useState<StudioRequestUsageDto | null>(null);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());

  const ragAvailable = Boolean(ragStatus?.hasIndex);

  useEffect(() => {
    if (ragMessage?.kind === "success" || ragMessage?.kind === "neutral") {
      const id = setTimeout(() => setRagMessage(null), 4000);
      return () => clearTimeout(id);
    }
  }, [ragMessage]);

  async function withBusy(key: string, task: () => Promise<void>) {
    setBusy((c) => new Set(c).add(key));
    try { await task(); } finally {
      setBusy((c) => { const n = new Set(c); n.delete(key); return n; });
    }
  }

  async function refreshRagStatus() {
    try {
      setRagStatus(await getRagStatus());
    } catch (error) {
      setRagMessage({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function handleBuildRag() {
    setRagMessage({ kind: "loading", text: "Indexing schema chunks..." });
    setRagResults(null);
    await withBusy("rag-build", async () => {
      try {
        const result = await buildRagIndex();
        setRagStatus(result.status);
        setRagIndexUsage(result.usage);
        const tokens = result.usage?.totalTokens ?? result.usage?.embeddingTokens ?? null;
        const tokenStr = tokens === null ? "" : `, ${new Intl.NumberFormat().format(tokens)} tokens`;
        setRagMessage({
          kind: "success",
          text: `Indexed ${result.stats.chunksIndexed ?? 0} chunks, reused ${result.stats.chunksReused ?? 0}${tokenStr}.`,
        });
      } catch (error) {
        setRagMessage({ kind: "error", text: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  async function handleQueryRag() {
    if (!ragQuestion.trim()) {
      setRagMessage({ kind: "error", text: "Enter a question before querying RAG." });
      return;
    }
    setRagMessage({ kind: "loading", text: "Retrieving chunks..." });
    await withBusy("rag-query", async () => {
      try {
        const result = await queryRag({ question: ragQuestion.trim(), k: ragK, types: ragTypes });
        setRagResults(result);
        setRagMessage({ kind: "success", text: `Retrieved ${result.results.length} chunks.` });
      } catch (error) {
        setRagMessage({ kind: "error", text: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  const value: RagContextValue = {
    ragStatus, ragMessage, ragQuestion, setRagQuestion, ragK, setRagK,
    ragTypes, setRagTypes, ragResults, ragIndexUsage, ragAvailable, busy,
    allChunkTypes: CHUNK_TYPES,
    refreshRagStatus, handleBuildRag, handleQueryRag,
  };

  return <RagContext.Provider value={value}>{children}</RagContext.Provider>;
}
