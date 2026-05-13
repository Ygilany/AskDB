export function EmptyText({ text }: { text: string }) {
  return (
    <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
      {text}
    </p>
  );
}
