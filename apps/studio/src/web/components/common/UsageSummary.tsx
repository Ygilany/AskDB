import type { StudioRequestUsageDto } from "@/shared/api";

const numberFormatter = new Intl.NumberFormat();

function formatNumber(n: number): string {
  return numberFormatter.format(n);
}

function UsageRow({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{formatNumber(value)}</dd>
    </div>
  );
}

export function UsageSummary({ title, usage }: { title: string; usage: StudioRequestUsageDto | null }) {
  if (!usage) return null;
  return (
    <section className="usage-summary" aria-label={title}>
      <h3>{title}</h3>
      <dl className="usage-grid">
        <UsageRow label="Prompt" value={usage.promptTokens} />
        <UsageRow label="Completion" value={usage.completionTokens} />
        <UsageRow label="Embeddings" value={usage.embeddingTokens} />
        <div className="usage-total">
          <dt>Total</dt>
          <dd>{formatNumber(usage.totalTokens)}</dd>
        </div>
      </dl>
    </section>
  );
}
