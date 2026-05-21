import { Settings } from "lucide-react";
import { useWorkspace } from "../../contexts/workspace-context";
import { useRag } from "../../contexts/rag-context";
import { EmptyText } from "../../components/common/EmptyText";

export function SettingsPage() {
  const { workspace } = useWorkspace();
  const { ragStatus } = useRag();

  if (!workspace) return null;

  return (
    <main className="main-pane">
      <div className="main-hd">
        <div className="main-title">
          <h1><Settings size={18} style={{ display: "inline", marginRight: 8 }} />Settings</h1>
          <div className="main-sub">Workspace configuration and diagnostics</div>
        </div>
      </div>
      <div className="main-body">
        <div className="stack" style={{ padding: "var(--pad-y) var(--pad-x)" }}>
          <section className="card">
            <div className="card-hd"><h3>Workspace</h3></div>
            <div className="card-bd">
              <dl className="definition-list">
                <dt>Schema ID</dt>
                <dd>{workspace.schemaId}</dd>
                <dt>Schema path</dt>
                <dd>{workspace.schemaDir}</dd>
                <dt>AI provider</dt>
                <dd>{workspace.aiProvider}</dd>
                <dt>Model</dt>
                <dd>{workspace.model}</dd>
                <dt>AI suggestions</dt>
                <dd>{workspace.aiConfigured ? "Configured" : "Not configured"}</dd>
              </dl>
            </div>
          </section>

          <section className="card">
            <div className="card-hd"><h3>RAG Store</h3></div>
            <div className="card-bd">
              {ragStatus ? (
                <dl className="definition-list">
                  <dt>Store</dt>
                  <dd>{ragStatus.store.kind}</dd>
                  <dt>Lock file</dt>
                  <dd>{ragStatus.files.lock ? "present" : "missing"}</dd>
                  {ragStatus.store.kind === "file" && (
                    <>
                      <dt>Base path</dt>
                      <dd>{ragStatus.store.basePath ?? "n/a"}</dd>
                      <dt>Embeddings JSON</dt>
                      <dd>{ragStatus.files.embeddingsJson ? "present" : "missing"}</dd>
                      <dt>Embeddings binary</dt>
                      <dd>{ragStatus.files.embeddingsBin ? "present" : "missing"}</dd>
                    </>
                  )}
                  {ragStatus.store.kind === "pgvector" && (
                    <>
                      <dt>Table</dt>
                      <dd>{ragStatus.store.table ?? "askdb_rag_chunks"}</dd>
                      <dt>Index strategy</dt>
                      <dd>{ragStatus.store.indexStrategy ?? "default"}</dd>
                    </>
                  )}
                  {ragStatus.store.kind === "memory" && (
                    <>
                      <dt>Persistence</dt>
                      <dd>In-process only</dd>
                    </>
                  )}
                </dl>
              ) : (
                <EmptyText text="RAG status is unavailable." />
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-hd"><h3>Schema Warnings</h3></div>
            <div className="card-bd">
              {workspace.warnings.length > 0 ? (
                <div style={{ display: "grid", gap: 8 }}>
                  {workspace.warnings.map((warning, i) => (
                    <pre className="warning-block" key={i}>
                      {typeof warning === "string" ? warning : JSON.stringify(warning, null, 2)}
                    </pre>
                  ))}
                </div>
              ) : (
                <EmptyText text="No schema warnings." />
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
