import { useCallback, useEffect, useState } from "react";
import type { AskResponse } from "@/shared/api";
import { ask as askApi } from "../../api";
import type { StatusMessage } from "../../components/common/types";
import { getErrorMessage } from "../../lib/format";

export type AskMode = "full" | "rag";

export type UseAskReturn = ReturnType<typeof useAsk>;

export function useAsk({ ragAvailable }: { ragAvailable: boolean }) {
  const [askQuestion, setAskQuestion] = useState("");
  const [askMode, setAskMode] = useState<AskMode>("full");
  const [askMessage, setAskMessage] = useState<StatusMessage | null>(null);
  const [askResult, setAskResult] = useState<AskResponse | null>(null);
  const [isAsking, setIsAsking] = useState(false);

  useEffect(() => {
    if (!ragAvailable && askMode === "rag") {
      setAskMode("full");
    }
  }, [ragAvailable, askMode]);

  const handleAsk = useCallback(async () => {
    if (!askQuestion.trim()) {
      setAskMessage({ kind: "error", text: "Enter a question before generating SQL." });
      return;
    }
    setAskMessage({ kind: "loading", text: "Generating SQL..." });
    setAskResult(null);
    setIsAsking(true);
    try {
      const result = await askApi({
        question: askQuestion.trim(),
        mode: askMode,
      });
      setAskResult(result);
      setAskMessage({ kind: "success", text: "Generated SQL." });
    } catch (error) {
      setAskMessage({ kind: "error", text: getErrorMessage(error) });
    } finally {
      setIsAsking(false);
    }
  }, [askQuestion, askMode]);

  return {
    askQuestion,
    setAskQuestion,
    askMode,
    setAskMode,
    askMessage,
    askResult,
    isAsking,
    handleAsk,
  };
}
