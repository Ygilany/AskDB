import type { StudioRagStatusDto, StudioWorkspaceDto } from "@/shared/api";
import { Panel } from "../../components/ui";
import { EmptyText } from "../../components/common/EmptyText";
import { formatUnknown } from "../../lib/format";

export function SettingsPanel({
  ragStatus,
  workspace,
}: {
  ragStatus: StudioRagStatusDto | null;
  workspace: StudioWorkspaceDto;
}) {
  return (
    <div className="grid gap-0">
      <Panel title="Workspace">
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
      </Panel>
      <Panel title="RAG Files">
        {ragStatus ? (
          <dl className="definition-list">
            <dt>Lock file</dt>
            <dd>{ragStatus.files.lock ? "present" : "missing"}</dd>
            <dt>Embeddings JSON</dt>
            <dd>{ragStatus.files.embeddingsJson ? "present" : "missing"}</dd>
            <dt>Embeddings binary</dt>
            <dd>{ragStatus.files.embeddingsBin ? "present" : "missing"}</dd>
          </dl>
        ) : (
          <EmptyText text="RAG status is unavailable." />
        )}
      </Panel>
      <Panel title="Schema Warnings">
        {workspace.warnings.length > 0 ? (
          <div className="grid gap-2">
            {workspace.warnings.map((warning, index) => (
              <pre className="warning-block" key={index}>
                {formatUnknown(warning)}
              </pre>
            ))}
          </div>
        ) : (
          <EmptyText text="No schema warnings." />
        )}
      </Panel>
    </div>
  );
}
