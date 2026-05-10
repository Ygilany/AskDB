import { Box, Text, useApp, useInput } from "ink";
import { useMemo, useState } from "react";
import {
  buildDefaultTableBody,
  replaceTableDescription,
  saveTable,
  type Workspace,
  type WorkspaceTable,
} from "../workspace.js";
import { TableDetail } from "./TableDetail.js";
import { TableList } from "./TableList.js";

type AppProps = {
  workspace: Workspace;
};

type Screen = "list" | "detail";

export function App({ workspace }: AppProps): JSX.Element {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>("list");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    buildInitialDrafts(workspace),
  );
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  const current = workspace.tables[selectedIndex];
  const draftDescription = current ? drafts[current.physical.id] ?? "" : "";

  useInput((input) => {
    if (screen === "list" && input === "q") {
      exit();
    }
  });

  const detailKey = current?.physical.id ?? "none";
  const showSaved = savedFlash === detailKey;

  const handleSave = useMemo(
    () => () => {
      if (!current) return;
      const fm = current.parsed
        ? { ...current.parsed.frontmatter }
        : {
            id: current.physical.id,
            name: current.physical.name,
            schemaId: workspace.physical.schemaId,
          };
      const body = current.parsed
        ? replaceTableDescription(current.parsed.body, draftDescription)
        : buildDefaultTableBody(current.physical.name, draftDescription);
      saveTable(workspace, current.physical.id, fm, body);
      setSavedFlash(current.physical.id);
    },
    [current, draftDescription, workspace],
  );

  if (screen === "list" || !current) {
    return (
      <Box flexDirection="row">
        <TableList
          workspace={workspace}
          selectedIndex={selectedIndex}
          onSelect={setSelectedIndex}
          onOpen={(i) => {
            setSelectedIndex(i);
            setScreen("detail");
          }}
        />
        <Box flexDirection="column" paddingX={2} paddingY={1}>
          <Text bold>AskDB TUI</Text>
          <Text dimColor>Schema: {workspace.physical.schemaId}</Text>
          <Text dimColor>Path:   {workspace.schemaDir}</Text>
          <Box marginTop={1}>
            <Text>Select a table on the left and press Enter.</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <TableList
        workspace={workspace}
        selectedIndex={selectedIndex}
        onSelect={(i) => {
          setSelectedIndex(i);
          setSavedFlash(null);
        }}
        onOpen={(i) => {
          setSelectedIndex(i);
          setScreen("detail");
        }}
      />
      <TableDetail
        key={current.physical.id}
        physical={current.physical}
        parsed={current.parsed}
        description={draftDescription}
        saved={showSaved}
        onEditDescription={(next) => {
          setDrafts((prev) => ({ ...prev, [current.physical.id]: next }));
          setSavedFlash(null);
        }}
        onSaveDescription={handleSave}
        onBack={() => setScreen("list")}
      />
    </Box>
  );
}

function buildInitialDrafts(workspace: Workspace): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of workspace.tables) {
    out[t.physical.id] = extractDescriptionFromTable(t);
  }
  return out;
}

function extractDescriptionFromTable(t: WorkspaceTable): string {
  if (!t.parsed) return "";
  return extractFirstParagraph(t.parsed.body) ?? "";
}

function extractFirstParagraph(body: string): string | undefined {
  const lines = body.split("\n");
  const out: string[] = [];
  let inParagraph = false;
  let seenHeading = false;
  for (const line of lines) {
    if (line.startsWith("#")) {
      if (seenHeading) break;
      seenHeading = true;
      continue;
    }
    if (line.trim() === "") {
      if (inParagraph) break;
      continue;
    }
    inParagraph = true;
    out.push(line.trim());
  }
  return out.length > 0 ? out.join(" ") : undefined;
}
