import type { StudioRequestUsageDto } from "@/shared/api";

export function formatList(list: string[] | undefined): string {
  return list?.join(", ") ?? "";
}

export function parseList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function formatUsageInline(usage: StudioRequestUsageDto | null): string {
  const tokens = usage?.totalTokens ?? usage?.embeddingTokens ?? null;
  return tokens === null ? "" : `, ${formatNumber(tokens)} tokens`;
}

export function emptyToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
