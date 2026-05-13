import { useCallback, useState } from "react";
import type { ChunkType } from "@askdb/rag";
import type {
  RagQueryResponse,
  StudioRagStatusDto,
  StudioRequestUsageDto,
} from "@/shared/api";
import { buildRagIndex, getRagStatus, queryRag } from "../../api";
import type { StatusMessage } from "../../components/common/types";
import { formatUsageInline, getErrorMessage } from "../../lib/format";

const DEFAULT_TYPES: ChunkType[] = ["table", "column", "cql", "question", "concept"];

export type UseRagReturn = ReturnType<typeof useRag>;

export function useRag() {
  const [ragStatus, setRagStatus] = useState<StudioRagStatusDto | null>(null);
  const [ragMessage, setRagMessage] = useState<StatusMessage | null>(null);
  const [ragQuestion, setRagQuestion] = useState("");
  const [ragK, setRagK] = useState(8);
  const [ragTypes, setRagTypes] = useState<ChunkType[]>(DEFAULT_TYPES);
  const [ragResults, setRagResults] = useState<RagQueryResponse | null>(null);
  const [ragIndexUsage, setRagIndexUsage] = useState<StudioRequestUsageDto | null>(null);
  const [isBuildingIndex, setIsBuildingIndex] = useState(false);
  const [isQuerying, setIsQuerying] = useState(false);

  const ragAvailable = Boolean(ragStatus?.hasIndex);

  const load = useCallback(async () => {
    setRagStatus(await getRagStatus());
  }, []);

  const refreshRagStatus = useCallback(async () => {
    try {
      setRagStatus(await getRagStatus());
    } catch (error) {
      setRagMessage({ kind: "error", text: getErrorMessage(error) });
    }
  }, []);

  const handleBuildRag = useCallback(async () => {
    setRagMessage({ kind: "loading", text: "Indexing schema chunks..." });
    setRagResults(null);
    setIsBuildingIndex(true);
    try {
      const result = await buildRagIndex();
      setRagStatus(result.status);
      setRagIndexUsage(result.usage);
      setRagMessage({
        kind: "success",
        text: `Indexed ${result.stats.chunksIndexed ?? 0} chunks, reused ${result.stats.chunksReused ?? 0}${formatUsageInline(result.usage)}.`,
      });
    } catch (error) {
      setRagMessage({ kind: "error", text: getErrorMessage(error) });
    } finally {
      setIsBuildingIndex(false);
    }
  }, []);

  const handleQueryRag = useCallback(async () => {
    if (!ragQuestion.trim()) {
      setRagMessage({ kind: "error", text: "Enter a question before querying RAG." });
      return;
    }
    setRagMessage({ kind: "loading", text: "Retrieving chunks..." });
    setIsQuerying(true);
    try {
      const result = await queryRag({
        question: ragQuestion.trim(),
        k: ragK,
        types: ragTypes,
      });
      setRagResults(result);
      setRagMessage({ kind: "success", text: `Retrieved ${result.results.length} chunks.` });
    } catch (error) {
      setRagMessage({ kind: "error", text: getErrorMessage(error) });
    } finally {
      setIsQuerying(false);
    }
  }, [ragQuestion, ragK, ragTypes]);

  return {
    ragStatus,
    ragAvailable,
    ragMessage,
    ragResults,
    ragIndexUsage,
    ragQuestion,
    setRagQuestion,
    ragK,
    setRagK,
    ragTypes,
    setRagTypes,
    isBuildingIndex,
    isQuerying,
    handleBuildRag,
    handleQueryRag,
    refreshRagStatus,
    load,
  };
}
