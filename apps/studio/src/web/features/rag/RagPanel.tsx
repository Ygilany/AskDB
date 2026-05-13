import { BrainCircuit, Loader2, RefreshCw, Search } from "lucide-react";
import type { ChunkType } from "@askdb/rag";
import { Badge, Button, Field, Input, Panel, Textarea } from "../../components/ui";
import { ChunkList } from "../../components/common/ChunkList";
import { InlineStatus } from "../../components/common/StatusBanner";
import { Metric } from "../../components/common/Metric";
import { UsageSummary } from "../../components/common/UsageSummary";
import type { UseRagReturn } from "./useRag";

const CHUNK_TYPES: ChunkType[] = [
  "table",
  "column",
  "cql",
  "question",
  "concept",
  "relationship",
];

export function RagPanel({ rag }: { rag: UseRagReturn }) {
  const {
    ragStatus: status,
    ragMessage: message,
    ragResults: results,
    ragIndexUsage: indexUsage,
    ragQuestion: question,
    setRagQuestion: onQuestionChange,
    ragK,
    setRagK,
    ragTypes: selectedTypes,
    setRagTypes: onTypesChange,
    isBuildingIndex,
    isQuerying,
    handleBuildRag: onBuild,
    handleQueryRag: onQuery,
    refreshRagStatus: onRefresh,
  } = rag;

  const queryDisabled = !status?.hasIndex || status.stale || isQuerying;

  return (
    <div className="grid gap-0">
      <Panel
        title="RAG Index"
        action={
          <Button size="sm" variant="ghost" onClick={() => void onRefresh()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      >
        {status ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <Metric value={status.chunksTotal} label="Chunks" />
              <Metric value={status.chunksIndexed} label="Indexed" />
              <Metric value={status.sensitiveExcluded} label="Sensitive out" />
              <Metric value={status.sensitiveIncluded} label="Sensitive in" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={status.hasIndex ? "secondary" : "warning"}>
                {status.hasIndex ? "Index present" : "No index"}
              </Badge>
              <Badge variant={status.stale ? "warning" : "secondary"}>
                {status.stale ? "Stale" : "Fresh"}
              </Badge>
              <Badge variant={status.embedder.configured ? "secondary" : "warning"}>
                {status.embedder.label}
              </Badge>
            </div>
            <div className="grid gap-1 text-xs text-muted-foreground">
              <span className="break-all">Expected: {status.expectedEmbedderId}</span>
              <span className="break-all">Indexed: {status.embedder.indexedId ?? "none"}</span>
              <span>
                Dimensions: {status.dimensions} / expected {status.expectedDimensions}
              </span>
              <span>Updated: {status.updatedAt ?? "never"}</span>
            </div>
            <Button onClick={() => void onBuild()} disabled={isBuildingIndex}>
              {isBuildingIndex ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <BrainCircuit className="h-4 w-4" />
              )}
              Build Index
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">RAG status is unavailable.</p>
        )}
      </Panel>

      <Panel title="Query Debugger">
        <div className="grid gap-3">
          <Field label="Question">
            <Textarea
              value={question}
              onChange={(event) => onQuestionChange(event.target.value)}
              placeholder="Which customers placed orders last month?"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
            <Field label="Top K">
              <Input
                min={1}
                max={25}
                type="number"
                value={ragK}
                onChange={(event) => setRagK(Number(event.target.value))}
              />
            </Field>
            <div className="grid gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Chunk types</span>
              <div className="flex flex-wrap gap-2">
                {CHUNK_TYPES.map((type) => (
                  <label className="chunk-toggle" key={type}>
                    <input
                      checked={selectedTypes.includes(type)}
                      type="checkbox"
                      onChange={(event) => {
                        if (event.target.checked) onTypesChange([...selectedTypes, type]);
                        else
                          onTypesChange(selectedTypes.filter((candidate) => candidate !== type));
                      }}
                    />
                    {type}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <Button disabled={queryDisabled} onClick={() => void onQuery()}>
            {isQuerying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Query RAG
          </Button>
          {message ? <InlineStatus status={message} /> : null}
          <UsageSummary title="Last Index Usage" usage={indexUsage} />
          <UsageSummary title="Last Query Usage" usage={results?.usage ?? null} />
        </div>
      </Panel>

      <ChunkList chunks={results?.results ?? []} emptyText="No chunks retrieved yet." />
    </div>
  );
}
