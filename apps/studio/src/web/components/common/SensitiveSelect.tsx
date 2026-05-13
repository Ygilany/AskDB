export function SensitiveSelect({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: boolean | undefined) => void;
  value: boolean | undefined;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <select
        className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={value === undefined ? "inherit" : value ? "true" : "false"}
        onChange={(event) => {
          if (event.target.value === "inherit") onChange(undefined);
          else onChange(event.target.value === "true");
        }}
      >
        <option value="inherit">Inherit physical metadata</option>
        <option value="true">Sensitive</option>
        <option value="false">Not sensitive</option>
      </select>
    </label>
  );
}
