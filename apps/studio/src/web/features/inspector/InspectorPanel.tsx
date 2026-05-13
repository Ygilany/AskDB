import { Bot, BrainCircuit, Settings } from "lucide-react";
import { useState } from "react";
import type { StudioWorkspaceDto } from "@/shared/api";
import { InspectorTab } from "../../components/common/InspectorTab";
import { AskPanel } from "../ask/AskPanel";
import type { UseAskReturn } from "../ask/useAsk";
import { RagPanel } from "../rag/RagPanel";
import type { UseRagReturn } from "../rag/useRag";
import { SettingsPanel } from "../settings/SettingsPanel";

type PanelKey = "rag" | "ask" | "settings";

export function InspectorPanel({
  ask,
  rag,
  workspace,
}: {
  ask: UseAskReturn;
  rag: UseRagReturn;
  workspace: StudioWorkspaceDto;
}) {
  const [active, setActive] = useState<PanelKey>("ask");

  return (
    <aside className="studio-inspector">
      <div className="border-b border-border p-3">
        <div className="grid grid-cols-3 gap-2">
          <InspectorTab
            active={active === "ask"}
            icon={<Bot className="h-4 w-4" />}
            label="Ask"
            onClick={() => setActive("ask")}
          />
          <InspectorTab
            active={active === "rag"}
            icon={<BrainCircuit className="h-4 w-4" />}
            label="RAG"
            onClick={() => setActive("rag")}
          />
          <InspectorTab
            active={active === "settings"}
            icon={<Settings className="h-4 w-4" />}
            label="Status"
            onClick={() => setActive("settings")}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {active === "rag" ? <RagPanel rag={rag} /> : null}
        {active === "ask" ? (
          <AskPanel
            ask={ask}
            ragAvailable={rag.ragAvailable}
            onGoToRag={() => setActive("rag")}
          />
        ) : null}
        {active === "settings" ? (
          <SettingsPanel workspace={workspace} ragStatus={rag.ragStatus} />
        ) : null}
      </div>
    </aside>
  );
}
