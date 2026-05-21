import { NavLink } from "react-router";
import {
  Database,
  Hexagon,
  LayoutGrid,
  Moon,
  Play,
  Settings,
  Shield,
  Sparkles,
  Sun,
  Table2,
} from "lucide-react";
import { useWorkspace } from "../../contexts/workspace-context";
import { useTheme } from "../../contexts/theme-context";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarSeparator,
  SidebarTrigger,
} from "../ui/sidebar";

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
  const { theme, toggleTheme } = useTheme();

  function getBadge(key?: string): string | undefined {
    if (!workspace || !key) return undefined;
    if (key === "tables") return String(workspace.tables.length);
    if (key === "concepts") return String(workspace.concepts.length);
    return undefined;
  }

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="px-2 py-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="AskDB Studio">
              <a href="/" className="no-underline">
                <div className="flex aspect-square size-8 items-center justify-center shrink-0">
                  <img
                    src={theme === "dark" ? "/assets/brand/dark-icon.png" : "/assets/brand/light-icon.png"}
                    alt="AskDB"
                    className="size-7"
                  />
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">AskDB</span>
                  <span className="text-xs text-muted-foreground">Studio</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const badge = getBadge(item.badgeKey);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild tooltip={item.label}>
                      <NavLink to={item.to}>
                        <Icon />
                        <span>{item.label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                    {badge && <SidebarMenuBadge>{badge}</SidebarMenuBadge>}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Settings">
              <NavLink to="/settings">
                <Settings />
                <span>Settings</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={theme === "light" ? "Dark mode" : "Light mode"}
              onClick={toggleTheme}
            >
              {theme === "light" ? <Moon /> : <Sun />}
              <span>{theme === "light" ? "Dark mode" : "Light mode"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarSeparator />
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <Database size={14} className="shrink-0" />
          <span className="truncate font-mono group-data-[collapsible=icon]:hidden">
            {workspace
              ? `${workspace.aiProvider || "postgres"} · ${workspace.schemaId.split("/").pop() || workspace.schemaId}`
              : "connecting…"}
          </span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
