import { NavLink } from "react-router";
import {
  Database,
  Hexagon,
  LayoutGrid,
  Play,
  Settings,
  Shield,
  Sparkles,
  Table2,
} from "lucide-react";
import { useWorkspace } from "../../contexts/workspace-context";

const NAV_ITEMS = [
  { to: "/overview", label: "Overview", icon: LayoutGrid },
  { to: "/tables", label: "Tables", icon: Table2, badgeKey: "tables" as const },
  { to: "/concepts", label: "Concepts", icon: Hexagon, badgeKey: "concepts" as const },
  { to: "/tenancy", label: "Tenancy", icon: Shield },
  { to: "/rag-index", label: "RAG Index", icon: Sparkles },
  { to: "/playground", label: "Playground", icon: Play },
];

export function NavRail() {
  const { workspace } = useWorkspace();

  function getBadge(key?: string): string | undefined {
    if (!workspace || !key) return undefined;
    if (key === "tables") return String(workspace.tables.length);
    if (key === "concepts") return String(workspace.concepts.length);
    return undefined;
  }

  return (
    <aside className="nav-rail">
      <div className="nav-items">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const badge = getBadge(item.badgeKey);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            >
              <Icon className="nav-icon" size={16} />
              <span className="nav-label">{item.label}</span>
              {badge && <span className="nav-badge">{badge}</span>}
            </NavLink>
          );
        })}
      </div>
      <div className="nav-foot">
        <NavLink
          to="/settings"
          className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
        >
          <Settings className="nav-icon" size={16} />
          <span className="nav-label">Settings</span>
        </NavLink>
      </div>
      <div className="nav-conn">
        <Database size={14} />
        <span className="mono">
          {workspace
            ? `${workspace.aiProvider || "postgres"} · ${workspace.schemaId.split("/").pop() || workspace.schemaId}`
            : "connecting…"}
        </span>
      </div>
    </aside>
  );
}
