import { AlertCircle, Loader2, Lock, Sparkles } from "lucide-react";
import { Button, Field, Panel, Textarea } from "../../components/ui";
import { ChunkList } from "../../components/common/ChunkList";
import { CopyButton } from "../../components/common/CopyButton";
import { EmptyText } from "../../components/common/EmptyText";
import { InlineStatus } from "../../components/common/StatusBanner";
import { UsageSummary } from "../../components/common/UsageSummary";
import { formatUnknown } from "../../lib/format";
import { cn } from "../../lib/utils";
import type { UseAskReturn } from "./useAsk";

const RAG_DISABLED_REASON = "Build the RAG index first to query with retrieval.";

export function AskPanel({
  ask,
  ragAvailable,
  onGoToRag,
}: {
  ask: UseAskReturn;
  ragAvailable: boolean;
  onGoToRag: () => void;
}) {
  const {
    askQuestion: question,
    setAskQuestion: onQuestionChange,
    askMode: mode,
    setAskMode: onModeChange,
    askMessage: message,
    askResult: result,
    isAsking,
    handleAsk: onAsk,
  } = ask;

  return (
    <div className="grid gap-0">
      <Panel title="Sample SQL">
        <div className="grid gap-3">
          <Field label="Question">
            <Textarea
              value={question}
              onChange={(event) => onQuestionChange(event.target.value)}
              placeholder="How many users placed orders?"
            />
          </Field>
          <div className="grid gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Retrieval mode</span>
            <div
              className={cn("segmented", !ragAvailable && "segmented-with-disabled")}
              role="group"
              aria-label="Retrieval mode"
            >
              <button
                className={cn(mode === "full" && "active")}
                type="button"
                onClick={() => onModeChange("full")}
              >
                Full schema
              </button>
              <button
                aria-disabled={!ragAvailable}
                aria-describedby={!ragAvailable ? "ask-rag-disabled-reason" : undefined}
                className={cn(mode === "rag" && "active")}
                disabled={!ragAvailable}
                title={!ragAvailable ? RAG_DISABLED_REASON : undefined}
                type="button"
                onClick={() => onModeChange("rag")}
              >
                <span className="inline-flex items-center gap-1.5">
                  {!ragAvailable ? <Lock className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                  RAG
                </span>
              </button>
            </div>
            {!ragAvailable ? (
              <div className="rag-unavailable-hint" id="ask-rag-disabled-reason" role="note">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  RAG retrieval is unavailable — no index has been built yet.{" "}
                  <button className="link-button" type="button" onClick={onGoToRag}>
                    Open the RAG tab
                  </button>{" "}
                  to build one.
                </span>
              </div>
            ) : null}
          </div>
          <Button disabled={isAsking} onClick={() => void onAsk()}>
            {isAsking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Generate SQL
          </Button>
          {message ? <InlineStatus status={message} /> : null}
        </div>
      </Panel>

      <Panel
        title="Generated SQL"
        action={result?.sql ? <CopyButton value={result.sql} /> : undefined}
      >
        {result?.sql ? (
          <pre className="sql-block">{result.sql}</pre>
        ) : (
          <EmptyText text="No SQL generated yet." />
        )}
      </Panel>

      <UsageSummary title="Request Usage" usage={result?.usage ?? null} />

      {result?.explain !== null && result?.explain !== undefined ? (
        <Panel title="Explain">
          <pre className="plain-block">{formatUnknown(result.explain)}</pre>
        </Panel>
      ) : null}

      {result?.warnings && result.warnings.length > 0 ? (
        <Panel title="Warnings">
          <div className="grid gap-2">
            {result.warnings.map((warning, index) => (
              <pre className="warning-block" key={index}>
                {formatUnknown(warning)}
              </pre>
            ))}
          </div>
        </Panel>
      ) : null}

      {result?.rag.enabled ? (
        <ChunkList chunks={result.rag.chunks} emptyText="RAG returned no chunks." />
      ) : null}
    </div>
  );
}
