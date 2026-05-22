import { useLocation } from "react-router";
import { Search, Check, Sparkles } from "lucide-react";
import { useWorkspace } from "../../contexts/workspace-context";
import { useRag } from "../../contexts/rag-context";

export function Topbar() {
  const location = useLocation();
  const { workspace, dirty } = useWorkspace();
  const { ragStatus } = useRag();

  const crumbs = buildCrumbs(location.pathname);
  const indexFresh = ragStatus?.hasIndex && !ragStatus.stale;

  return (
    <>
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <span key={i}>
            {i > 0 && <span className="sep" style={{ marginRight: 8 }}>/</span>}
            <span className={i === crumbs.length - 1 ? "crumb cur" : "crumb"}>{c}</span>
          </span>
        ))}
        {dirty && (
          <span className="pill warn" style={{ marginLeft: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--amber-500)" }} />
            Unsaved changes
          </span>
        )}
        {!dirty && workspace && crumbs.some((c) => c === "Enrichment" || c === "Schema") && (
          <span className="pill ok" style={{ marginLeft: 8 }}>
            <Check size={10} />
            Saved
          </span>
        )}
      </div>

      <div className="right">
        <div className="cmd-palette">
          <Search size={13} />
          <span style={{ flex: 1 }}>Search tables, concepts, queries…</span>
          <span className="kbd">⌘K</span>
        </div>
        {ragStatus && (
          <span className={`pill ${indexFresh ? "ok" : "warn"}`}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: indexFresh ? "var(--green-500)" : "var(--amber-500)",
              }}
            />
            {indexFresh ? "Index fresh" : ragStatus.hasIndex ? "Index stale" : "No index"}
          </span>
        )}
      </div>
    </>
  );
}

function buildCrumbs(pathname: string): string[] {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return ["Overview"];

  const section = parts[0];
  const crumbs: string[] = [];

  switch (section) {
    case "overview":
      crumbs.push("Overview");
      break;
    case "tables":
      crumbs.push("Tables");
      if (parts[1]) crumbs.push(parts[1]);
      if (parts[2]) crumbs.push(parts[2]);
      if (parts[3]) crumbs.push(capitalize(parts[3]));
      break;
    case "concepts":
      crumbs.push("Concepts");
      break;
    case "tenancy":
      crumbs.push("Tenancy");
      if (parts[1]) crumbs.push(capitalize(parts[1]));
      break;
    case "rag-index":
      crumbs.push("RAG Index");
      if (parts[1]) crumbs.push(capitalize(parts[1]));
      break;
    case "playground":
      crumbs.push("Playground");
      if (parts[1]) crumbs.push("Query");
      break;
    case "settings":
      crumbs.push("Settings");
      break;
    default:
      crumbs.push(capitalize(section));
  }

  return crumbs;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
