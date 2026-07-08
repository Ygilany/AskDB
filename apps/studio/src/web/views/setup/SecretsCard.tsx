import { FileKey } from "lucide-react";
import { CopyButton } from "../../components/common/CopyButton";

export function SecretsCard({
  stepNumber,
  envVars,
}: {
  stepNumber: number;
  envVars: Array<{ name: string; purpose: string; requiredForIntrospection: boolean }>;
}) {
  const envSnippet = envVars.map((v) => `${v.name}=`).join("\n");

  return (
    <div className="card">
      <div className="card-hd">
        <h3><FileKey size={14} /> {stepNumber} · Add your secrets to .env</h3>
      </div>
      <div className="card-bd" style={{ display: "grid", gap: 10 }}>
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          Create a <code className="mono">.env</code> file next to <code className="mono">askdb.config.ts</code> and
          fill in the values. Studio never asks for secret values — they stay on disk, outside this UI.
        </p>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <pre className="mono" style={{ flex: 1, margin: 0, border: "1px solid var(--border)", borderRadius: 6, padding: 10, fontSize: 12, background: "var(--surface-2)" }}>
            {envVars.map((v) => `${v.name}=          # ${v.purpose}`).join("\n")}
          </pre>
          <CopyButton value={envSnippet} />
        </div>
      </div>
    </div>
  );
}
