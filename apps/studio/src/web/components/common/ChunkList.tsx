import type { StudioRagChunkDto } from "@/shared/api";
import { Badge, Panel } from "../ui";
import { EmptyText } from "./EmptyText";

export function ChunkList({
  chunks,
  emptyText,
}: {
  chunks: StudioRagChunkDto[];
  emptyText: string;
}) {
  return (
    <Panel title="Retrieved Chunks">
      {chunks.length > 0 ? (
        <div className="grid gap-3">
          {chunks.map((chunk) => (
            <article className="chunk-card" key={chunk.id}>
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="break-all text-sm font-semibold">{chunk.id}</h4>
                    <Badge variant="outline">{chunk.type}</Badge>
                    {chunk.sensitive ? <Badge variant="danger">sensitive</Badge> : null}
                  </div>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
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
    </Panel>
  );
}
