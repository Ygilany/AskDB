import type { StudioRequestUsageDto } from "@/shared/api";
import { formatNumber } from "../../lib/format";

export function UsageSummary({
  title,
  usage,
}: {
  title: string;
  usage: StudioRequestUsageDto | null;
}) {
  if (!usage) return null;
  const promptTokens = usage.promptTokens ?? usage.embeddingTokens;
  return (
    <section className="usage-summary" aria-label={title}>
      <h3>{title}</h3>
      <dl className="usage-grid">
        <UsageMetric
          label={usage.embeddingTokens === null ? "Prompt" : "Embeddings"}
          value={promptTokens}
        />
        <UsageMetric label="Completion" value={usage.completionTokens} />
        <UsageMetric className="usage-total" label="Total" value={usage.totalTokens} />
      </dl>
    </section>
  );
}

function UsageMetric({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: number | null;
}) {
  if (value === null) return null;
  return (
    <div className={className}>
      <dt>{label}</dt>
      <dd>{formatNumber(value)}</dd>
    </div>
  );
}
