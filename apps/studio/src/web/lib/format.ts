export function parseList(value: string): string[] {
  return value
    .split(",")
    .flatMap((item) => {
      const trimmed = item.trim();
      return trimmed ? [trimmed] : [];
    });
}

const numberFormat = new Intl.NumberFormat();

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
