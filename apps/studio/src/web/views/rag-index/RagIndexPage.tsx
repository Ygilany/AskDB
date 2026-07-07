import { BrainCircuit, Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import { useRag } from "../../contexts/rag-context";
import { useWorkspace } from "../../contexts/workspace-context";
import { Badge } from "../../components/ui/badge";
import { Field } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { InlineStatus } from "../../components/common/StatusBanner";
import { EmptyText } from "../../components/common/EmptyText";
import { UsageSummary } from "../../components/common/UsageSummary";
import type { StudioRagChunkDto } from "@/shared/api";
import { formatNumber } from "../../lib/format";

export function RagIndexPage() {
  const { workspace } = useWorkspace();
  const {
    ragStatus, ragMessage, ragQuestion, setRagQuestion, ragK, setRagK,
    ragTypes, setRagTypes, ragResults, ragIndexUsage, busy, allChunkTypes,
    refreshRagStatus, handleBuildRag, handleQueryRag,
  } = useRag();

  if (!workspace) return null;

  const queryDisabled = !ragStatus?.hasIndex || ragStatus.stale || busy.has("rag-query");

  return (
    <main className="main-pane">
      <div className="main-hd">
        <div className="main-title">
          <h1><Sparkles size={18} style={{ display: "inline", marginRight: 8 }} />RAG Index</h1>
          <div className="main-sub">Retrieval-augmented generation index and query debugger</div>
        </div>
        <div className="main-actions">
          <button type="button" className="btn" onClick={() => void refreshRagStatus()}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button type="button" className="btn primary" onClick={() => void handleBuildRag()} disabled={busy.has("rag-build")}>
            {busy.has("rag-build") ? <Loader2 size={14} className="animate-spin" /> : <BrainCircuit size={14} />}
            Build Index
          </button>
        </div>
      </div>
      <div className="main-body">
        <div className="stack" style={{ padding: "var(--pad-y) var(--pad-x)" }}>
          {ragMessage && <InlineStatus status={ragMessage} />}

          {ragStatus ? (
            <div className="grid-4">
              <div className="card stat-card">
                <div className="stat-label">Chunks</div>
                <div className="stat-num">{formatNumber(ragStatus.chunksTotal)}</div>
              </div>
              <div className="card stat-card">
                <div className="stat-label">Indexed</div>
                <div className="stat-num">{formatNumber(ragStatus.chunksIndexed)}</div>
              </div>
              <div className="card stat-card">
                <div className="stat-label">Sensitive excluded</div>
                <div className="stat-num">{ragStatus.sensitiveExcluded}</div>
              </div>
              <div className="card stat-card">
                <div className="stat-label">Sensitive included</div>
                <div className="stat-num">{ragStatus.sensitiveIncluded}</div>
              </div>
            </div>
          ) : (
            <EmptyText text="RAG status is unavailable." />
          )}

          {ragStatus && (
            <section className="card">
              <div className="card-hd"><h3>Index Details</h3></div>
              <div className="card-bd">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  <Badge variant={ragStatus.hasIndex ? "secondary" : "warning"}>
                    {ragStatus.hasIndex ? "Index present" : "No index"}
                  </Badge>
                  <Badge variant={ragStatus.stale ? "warning" : "secondary"}>
                    {ragStatus.stale ? "Stale" : "Fresh"}
                  </Badge>
                  <Badge variant={ragStatus.embedder.configured ? "secondary" : "warning"}>
                    {ragStatus.embedder.label}
                  </Badge>
                </div>
                <div style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--ink-400)" }}>
                  <span>Expected: {ragStatus.expectedEmbedderId}</span>
                  <span>Indexed: {ragStatus.embedder.indexedId ?? "none"}</span>
                  <span>Dimensions: {ragStatus.dimensions} / expected {ragStatus.expectedDimensions}</span>
                  <span>Updated: {ragStatus.updatedAt ?? "never"}</span>
                  <span>Store: {ragStatus.store.kind}</span>
                </div>
                <div className="bar" style={{ marginTop: 14 }}>
                  <i style={{ width: ragStatus.chunksTotal > 0 ? `${Math.round((ragStatus.chunksIndexed / ragStatus.chunksTotal) * 100)}%` : "0%" }} />
                </div>
              </div>
            </section>
          )}

          <section className="card">
            <div className="card-hd"><h3>Query Debugger</h3></div>
            <div className="card-bd">
              <div style={{ display: "grid", gap: 12 }}>
                <Field label="Question">
                  <Textarea
                    value={ragQuestion}
                    onChange={(e) => setRagQuestion(e.target.value)}
                    placeholder="Which customers placed orders last month?"
                  />
                </Field>
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "120px 1fr" }}>
                  <Field label="Top K">
                    <Input
                      min={1} max={25} type="number" value={ragK}
                      onChange={(e) => setRagK(Number(e.target.value))}
                    />
                  </Field>
                  <div style={{ display: "grid", gap: 6 }}>
                    <span className="muted" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Chunk types</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {allChunkTypes.map((type) => (
                        <label className="chunk-toggle" key={type}>
                          <input
                            checked={ragTypes.includes(type)}
                            type="checkbox"
                            onChange={(e) => {
                              if (e.target.checked) setRagTypes([...ragTypes, type]);
                              else setRagTypes(ragTypes.filter((t) => t !== type));
                            }}
                          />
                          {type}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <button type="button" className="btn primary" disabled={queryDisabled} onClick={() => void handleQueryRag()}>
                  {busy.has("rag-query") ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                  Query RAG
                </button>
                <UsageSummary title="Last Index Usage" usage={ragIndexUsage} />
                <UsageSummary title="Last Query Usage" usage={ragResults?.usage ?? null} />
              </div>
            </div>
          </section>

          <ChunkList chunks={ragResults?.results ?? []} emptyText="No chunks retrieved yet." />
        </div>
      </div>
    </main>
  );
}

function ChunkList({ chunks, emptyText }: { chunks: StudioRagChunkDto[]; emptyText: string }) {
  return (
    <section className="card">
      <div className="card-hd"><h3>Retrieved Chunks</h3></div>
      <div className="card-bd">
        {chunks.length > 0 ? (
          <div style={{ display: "grid", gap: 12 }}>
            {chunks.map((chunk) => (
              <article className="chunk-card" key={chunk.id}>
                <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                      <h4 style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-all" }}>{chunk.id}</h4>
                      <Badge variant="outline">{chunk.type}</Badge>
                      {chunk.sensitive && <Badge variant="danger">sensitive</Badge>}
                    </div>
                    <p className="muted tiny" style={{ marginTop: 4, wordBreak: "break-all" }}>
                      refs: {chunk.refs.length > 0 ? chunk.refs.join(", ") : "none"}
                    </p>
                  </div>
                  <Badge variant="secondary">{chunk.score.toFixed(3)}</Badge>
                </div>
                <pre className="chunk-text">{chunk.text}</pre>
              </article>
            ))}
          </div>
        ) : (
          <EmptyText text={emptyText} />
        )}
      </div>
    </section>
  );
}

