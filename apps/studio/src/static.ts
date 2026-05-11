export const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>AskDB Studio</title>
    <link rel="stylesheet" href="/assets/styles.css">
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/assets/app.js"></script>
  </body>
</html>
`;

export const STYLES_CSS = `:root {
  color-scheme: light;
  --bg: #f6f7f9;
  --panel: #ffffff;
  --panel-2: #f0f3f7;
  --line: #d7dee8;
  --line-strong: #b8c2cf;
  --text: #17202b;
  --muted: #647184;
  --accent: #0f766e;
  --accent-strong: #115e59;
  --danger: #b42318;
  --warn: #a15c07;
  --code: #101828;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

button,
input,
textarea {
  font: inherit;
}

button {
  border: 1px solid var(--line-strong);
  background: var(--panel);
  color: var(--text);
  border-radius: 6px;
  min-height: 32px;
  padding: 6px 10px;
  cursor: pointer;
}

button:hover {
  border-color: var(--accent);
}

button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

button.primary:hover {
  background: var(--accent-strong);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.shell {
  display: grid;
  grid-template-columns: 300px minmax(420px, 1fr) 420px;
  min-height: 100vh;
}

.shell.rag-shell {
  grid-template-columns: 300px minmax(520px, 1fr);
}

.sidebar,
.main,
.tester {
  min-width: 0;
}

.sidebar {
  border-right: 1px solid var(--line);
  background: #fbfcfe;
  display: flex;
  flex-direction: column;
}

.brand {
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--line);
}

.brand h1 {
  margin: 0;
  font-size: 18px;
  letter-spacing: 0;
}

.brand p {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--line);
}

.metric {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px;
}

.metric strong {
  display: block;
  font-size: 16px;
}

.metric span {
  display: block;
  color: var(--muted);
  font-size: 11px;
}

.table-list {
  overflow: auto;
  padding: 8px;
}

.nav {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--line);
}

.nav button {
  width: 100%;
}

.nav button.active {
  background: #e7f5f2;
  border-color: #9fd1ca;
  color: var(--accent-strong);
  font-weight: 700;
}

.table-row {
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 6px;
  padding: 8px;
  display: grid;
  gap: 2px;
}

.table-row.active {
  background: #e7f5f2;
  border-color: #9fd1ca;
}

.table-row .name {
  font-weight: 650;
  overflow-wrap: anywhere;
}

.table-row .meta {
  color: var(--muted);
  font-size: 12px;
}

.main {
  display: flex;
  flex-direction: column;
}

.toolbar {
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}

.toolbar h2 {
  margin: 0;
  font-size: 18px;
  letter-spacing: 0;
}

.toolbar .sub {
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.content {
  overflow: auto;
  padding: 16px;
}

.section {
  border-bottom: 1px solid var(--line);
  padding-bottom: 18px;
  margin-bottom: 18px;
}

.section h3 {
  font-size: 14px;
  margin: 0 0 10px;
  letter-spacing: 0;
}

.field {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: end;
}

label {
  color: var(--muted);
  font-size: 12px;
  font-weight: 650;
}

input,
textarea {
  width: 100%;
  border: 1px solid var(--line-strong);
  background: #fff;
  color: var(--text);
  border-radius: 6px;
  padding: 8px 10px;
  outline: none;
}

textarea {
  min-height: 86px;
  resize: vertical;
}

input:focus,
textarea:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.12);
}

.columns {
  display: grid;
  gap: 10px;
}

.column {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 12px;
}

.column-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.column-name {
  font-weight: 700;
  overflow-wrap: anywhere;
}

.column-type,
.badge {
  color: var(--muted);
  font-size: 12px;
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 7px;
}

.badge {
  border: 1px solid var(--line);
  background: var(--panel-2);
  border-radius: 999px;
  padding: 2px 7px;
}

.tester {
  border-left: 1px solid var(--line);
  background: #fbfcfe;
  display: flex;
  flex-direction: column;
}

.tester-head {
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}

.tester-head h2 {
  margin: 0;
  font-size: 16px;
}

.tester-body {
  padding: 16px;
  overflow: auto;
}

.sql {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--code);
  color: #f8fafc;
  border-radius: 6px;
  padding: 12px;
  min-height: 120px;
}

.rag-grid {
  display: grid;
  grid-template-columns: 280px minmax(360px, 1fr);
  gap: 16px;
  align-items: start;
}

.rag-panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 14px;
}

.rag-panel h3 {
  margin: 0 0 10px;
  font-size: 14px;
}

.rag-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 12px;
}

.checks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin: 8px 0 12px;
}

.checks label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text);
  font-weight: 500;
}

.checks input {
  width: auto;
}

.chunk-list {
  display: grid;
  gap: 10px;
}

.chunk {
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 6px;
  padding: 12px;
}

.chunk-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.chunk-title {
  font-weight: 700;
  overflow-wrap: anywhere;
}

.chunk-score {
  color: var(--accent-strong);
  font-variant-numeric: tabular-nums;
}

.chunk-refs {
  color: var(--muted);
  font-size: 12px;
  margin-bottom: 8px;
  overflow-wrap: anywhere;
}

.chunk-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
  color: var(--code);
}

.status {
  min-height: 22px;
  color: var(--muted);
  font-size: 12px;
}

.status.error {
  color: var(--danger);
}

.status.ok {
  color: var(--accent-strong);
}

.warn {
  color: var(--warn);
}

.empty {
  color: var(--muted);
  padding: 32px;
}

.overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: none;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.overlay.open {
  display: flex;
}

.dialog {
  width: min(720px, 100%);
  max-height: min(720px, 90vh);
  background: var(--panel);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  box-shadow: 0 22px 70px rgba(15, 23, 42, 0.24);
  display: flex;
  flex-direction: column;
}

.dialog-head,
.dialog-actions {
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
}

.dialog-actions {
  border-top: 1px solid var(--line);
  border-bottom: 0;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.dialog-body {
  padding: 14px;
  overflow: auto;
  display: grid;
  gap: 10px;
}

.candidate {
  width: 100%;
  text-align: left;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 10px;
  white-space: pre-wrap;
}

@media (max-width: 1180px) {
  .shell {
    grid-template-columns: 280px minmax(380px, 1fr);
  }
  .shell.rag-shell {
    grid-template-columns: 280px minmax(380px, 1fr);
  }
  .tester {
    grid-column: 1 / -1;
    border-left: 0;
    border-top: 1px solid var(--line);
  }
}

@media (max-width: 760px) {
  .shell {
    display: block;
  }
  .sidebar,
  .tester {
    border: 0;
    border-bottom: 1px solid var(--line);
  }
  .table-list {
    max-height: 240px;
  }
  .toolbar,
  .column-head,
  .field-row,
  .rag-grid {
    display: grid;
    grid-template-columns: 1fr;
  }
  .toolbar-actions {
    justify-content: start;
  }
}
`;

export const APP_JS = `const app = document.getElementById("app");

let state = {
  workspace: null,
  selectedTableId: null,
  view: "enrichment",
  drafts: new Map(),
  status: "",
  statusKind: "",
  askStatus: "",
  askStatusKind: "",
  sql: "",
  explain: null,
  ragStatus: null,
  ragStatusText: "",
  ragStatusKind: "",
  ragResults: [],
  ragQuestion: "",
  loading: true,
  suggestions: null
};

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "html") el.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null && value !== false) el.setAttribute(key, String(value));
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || "Request failed");
  return json;
}

async function load() {
  try {
    const [workspace, ragStatus] = await Promise.all([
      api("/api/workspace"),
      api("/api/rag/status")
    ]);
    state.workspace = workspace;
    state.ragStatus = ragStatus;
    state.selectedTableId = state.selectedTableId || workspace.tables[0]?.physical.id || null;
    state.drafts = new Map(workspace.tables.map((table) => [table.physical.id, clone(table.draft)]));
    state.loading = false;
    render();
  } catch (error) {
    state.loading = false;
    state.status = error.message;
    state.statusKind = "error";
    render();
  }
}

async function refreshRagStatus() {
  try {
    state.ragStatus = await api("/api/rag/status");
  } catch (error) {
    state.ragStatusText = error.message;
    state.ragStatusKind = "error";
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function selectedTable() {
  return state.workspace?.tables.find((table) => table.physical.id === state.selectedTableId) || null;
}

function selectedDraft() {
  return state.selectedTableId ? state.drafts.get(state.selectedTableId) : null;
}

function setDraft(next) {
  if (!state.selectedTableId) return;
  state.drafts.set(state.selectedTableId, next);
  state.status = "Unsaved changes";
  state.statusKind = "";
}

function listToInput(list) {
  return Array.isArray(list) ? list.join(", ") : "";
}

function inputToList(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function setTableField(field, value) {
  const draft = clone(selectedDraft());
  if (field === "aliases" || field === "tags") draft[field] = inputToList(value);
  else draft[field] = value;
  setDraft(draft);
}

function setColumnField(columnId, field, value) {
  const draft = clone(selectedDraft());
  draft.columns[columnId] = draft.columns[columnId] || {};
  if (field === "aliases" || field === "enum") draft.columns[columnId][field] = inputToList(value);
  else draft.columns[columnId][field] = value;
  setDraft(draft);
}

async function saveCurrent() {
  const table = selectedTable();
  const draft = selectedDraft();
  if (!table || !draft) return;
  state.status = "Saving...";
  state.statusKind = "";
  render();
  try {
    const workspace = await api("/api/tables/" + encodeURIComponent(table.physical.id), {
      method: "POST",
      body: JSON.stringify({ draft })
    });
    state.workspace = workspace;
    state.drafts = new Map(workspace.tables.map((item) => [item.physical.id, clone(item.draft)]));
    state.status = "Saved " + table.physical.name;
    state.statusKind = "ok";
    await refreshRagStatus();
    render();
  } catch (error) {
    state.status = error.message;
    state.statusKind = "error";
    render();
  }
}

async function buildRagIndex() {
  state.ragStatusText = "Indexing schema chunks...";
  state.ragStatusKind = "";
  state.ragResults = [];
  render();
  try {
    const result = await api("/api/rag/index", { method: "POST", body: JSON.stringify({}) });
    state.ragStatus = result.status;
    const stats = result.stats || {};
    state.ragStatusText = "Indexed " + (stats.chunksIndexed || 0) + " chunks, reused " + (stats.chunksReused || 0) + ".";
    state.ragStatusKind = "ok";
    render();
  } catch (error) {
    state.ragStatusText = error.message;
    state.ragStatusKind = "error";
    render();
  }
}

async function queryRag(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const question = String(form.get("question") || "").trim();
  const k = Number(form.get("k") || 8);
  const types = form.getAll("types").map(String);
  state.ragQuestion = question;
  state.ragStatusText = "Retrieving chunks...";
  state.ragStatusKind = "";
  state.ragResults = [];
  render();
  try {
    const result = await api("/api/rag/query", {
      method: "POST",
      body: JSON.stringify({ question, k, types })
    });
    state.ragResults = result.results || [];
    state.ragStatusText = "Retrieved " + state.ragResults.length + " chunks.";
    state.ragStatusKind = "ok";
    render();
  } catch (error) {
    state.ragStatusText = error.message;
    state.ragStatusKind = "error";
    render();
  }
}

async function requestSuggestion(source, title, apply) {
  state.status = "Requesting suggestion...";
  state.statusKind = "";
  render();
  try {
    const result = await api("/api/suggest", {
      method: "POST",
      body: JSON.stringify({ source })
    });
    state.suggestions = { title, candidates: result.candidates || [], apply };
    state.status = "";
    render();
  } catch (error) {
    state.status = error.message;
    state.statusKind = "error";
    render();
  }
}

async function askQuestion(event) {
  event.preventDefault();
  const question = new FormData(event.currentTarget).get("question");
  state.askStatus = "Generating SQL...";
  state.askStatusKind = "";
  state.sql = "";
  state.explain = null;
  render();
  try {
    const result = await api("/api/ask", {
      method: "POST",
      body: JSON.stringify({ question })
    });
    state.sql = result.sql.endsWith(";") ? result.sql : result.sql + ";";
    state.explain = result.explain;
    state.askStatus = "Generated against the current saved schema enrichment.";
    state.askStatusKind = "ok";
    render();
  } catch (error) {
    state.askStatus = error.message;
    state.askStatusKind = "error";
    render();
  }
}

function render() {
  app.replaceChildren();
  if (state.loading) {
    app.append(h("div", { class: "empty", text: "Loading AskDB Studio..." }));
    return;
  }
  if (!state.workspace) {
    app.append(h("div", { class: "empty" }, [
      h("strong", { text: "Studio could not load." }),
      h("p", { class: state.statusKind, text: state.status })
    ]));
    return;
  }

  if (state.view === "rag") {
    app.append(h("div", { class: "shell rag-shell" }, [
      renderSidebar(),
      renderRagPage()
    ]));
  } else {
    const table = selectedTable();
    const draft = selectedDraft();
    app.append(h("div", { class: "shell" }, [
      renderSidebar(),
      table && draft ? renderEditor(table, draft) : h("main", { class: "main empty", text: "No tables found." }),
      renderTester()
    ]));
  }
  renderSuggestionDialog();
}

function renderSidebar() {
  const workspace = state.workspace;
  const describedCount = workspace.tables.filter((table) => table.hasDescribableFile).length;
  const missingColumns = workspace.warnings.filter((warning) => warning.kind === "missing_column_md").length;
  return h("aside", { class: "sidebar" }, [
    h("div", { class: "brand" }, [
      h("h1", { text: "AskDB Studio" }),
      h("p", { text: workspace.schemaId }),
      h("p", { text: workspace.schemaDir })
    ]),
    h("div", { class: "summary" }, [
      metric(workspace.tables.length, "tables"),
      metric(describedCount, "described"),
      metric(missingColumns, "gaps")
    ]),
    h("div", { class: "nav" }, [
      h("button", {
        class: state.view === "enrichment" ? "active" : "",
        onclick: () => { state.view = "enrichment"; render(); },
        text: "Enrichment"
      }),
      h("button", {
        class: state.view === "rag" ? "active" : "",
        onclick: async () => { state.view = "rag"; await refreshRagStatus(); render(); },
        text: "RAG"
      })
    ]),
    h("div", { class: "table-list" }, workspace.tables.map((table) =>
      h("button", {
        class: "table-row" + (table.physical.id === state.selectedTableId ? " active" : ""),
        onclick: () => {
          state.selectedTableId = table.physical.id;
          state.status = "";
          render();
        }
      }, [
        h("span", { class: "name", text: table.physical.name }),
        h("span", { class: "meta", text: table.physical.schema + " | " + table.physical.columns.length + " columns" })
      ])
    ))
  ]);
}

function renderRagPage() {
  const status = state.ragStatus || {};
  const embedder = status.embedder || {};
  const queryInput = h("textarea", { name: "question" });
  queryInput.value = state.ragQuestion || "How much revenue did customers generate last month?";
  const kInput = h("input", { name: "k", type: "number", min: "1", max: "25", value: "8" });
  const types = ["table", "column", "cql", "question", "concept", "relationship"];
  return h("main", { class: "main" }, [
    h("div", { class: "toolbar" }, [
      h("div", {}, [
        h("h2", { text: "RAG practice" }),
        h("div", { class: "sub", text: "Inspect which Schema v2 chunks retrieval ranks for a question." })
      ]),
      h("div", { class: "toolbar-actions" }, [
        h("span", { class: "status " + state.ragStatusKind, text: state.ragStatusText }),
        h("button", { onclick: async () => { await refreshRagStatus(); render(); }, text: "Refresh" }),
        h("button", { class: "primary", onclick: buildRagIndex, disabled: embedder.configured === false ? "true" : undefined, text: status.hasIndex ? "Reindex" : "Build index" })
      ])
    ]),
    h("div", { class: "content" }, [
      h("div", { class: "rag-grid" }, [
        h("section", { class: "rag-panel" }, [
          h("h3", { text: "Index status" }),
          h("div", { class: "rag-metrics" }, [
            metric(status.chunksTotal ?? 0, "chunks"),
            metric(status.chunksIndexed ?? 0, "indexed"),
            metric(status.sensitiveExcluded ?? 0, "sensitive skipped"),
            metric(status.expectedDimensions ?? status.dimensions ?? 64, "dimensions")
          ]),
          h("p", { class: "status " + (status.stale ? "error" : "ok"), text:
            status.hasIndex
              ? (status.stale ? "Index is stale. Reindex before tuning." : "Index is current.")
              : "No local RAG index has been built."
          }),
          h("p", { class: "status " + (embedder.configured === false ? "error" : ""), text:
            "Configured embedder: " + (embedder.label || "Mock lexical") +
            (embedder.model ? " / " + embedder.model : "")
          }),
          h("p", { class: "status", text: "Index embedder: " + (embedder.indexedId || "none") }),
          h("p", { class: "status", text: "Expected embedder: " + (embedder.expectedId || status.expectedEmbedderId || "studio:mock-lexical-64") }),
          h("p", { class: "status", text: "Updated: " + (status.updatedAt || "never") }),
          h("div", { class: "badges" }, [
            h("span", { class: "badge", text: "lock " + (status.files?.lock ? "yes" : "no") }),
            h("span", { class: "badge", text: "json " + (status.files?.embeddingsJson ? "yes" : "no") }),
            h("span", { class: "badge", text: "bin " + (status.files?.embeddingsBin ? "yes" : "no") })
          ])
        ]),
        h("section", { class: "rag-panel" }, [
          h("h3", { text: "Practice query" }),
          h("form", { onsubmit: queryRag }, [
            h("div", { class: "field" }, [
              h("label", { text: "Question" }),
              queryInput
            ]),
            h("div", { class: "field" }, [
              h("label", { text: "Top K" }),
              kInput
            ]),
            h("label", { text: "Chunk types" }),
            h("div", { class: "checks" }, types.map((type) => {
              const input = h("input", { type: "checkbox", name: "types", value: type });
              input.checked = true;
              return h("label", {}, [input, type]);
            })),
            h("button", { class: "primary", type: "submit", disabled: status.hasIndex && !status.stale && embedder.configured !== false ? undefined : "true", text: "Retrieve chunks" })
          ])
        ])
      ]),
      h("section", { class: "section" }, [
        h("h3", { text: "Retrieved chunks" }),
        state.ragResults.length
          ? h("div", { class: "chunk-list" }, state.ragResults.map(renderChunk))
          : h("p", { class: "empty", text: "Run a practice query to inspect ranked chunks." })
      ])
    ])
  ]);
}

function renderChunk(chunk) {
  return h("article", { class: "chunk" }, [
    h("div", { class: "chunk-head" }, [
      h("div", { class: "chunk-title", text: chunk.type + " | " + chunk.id }),
      h("div", { class: "chunk-score", text: String(chunk.score) })
    ]),
    h("div", { class: "chunk-refs", text: "refs: " + (chunk.refs || []).join(", ") }),
    h("pre", { class: "chunk-text", text: chunk.text })
  ]);
}

function metric(value, label) {
  return h("div", { class: "metric" }, [
    h("strong", { text: String(value) }),
    h("span", { text: label })
  ]);
}

function renderEditor(table, draft) {
  const physical = table.physical;
  return h("main", { class: "main" }, [
    h("div", { class: "toolbar" }, [
      h("div", {}, [
        h("h2", { text: physical.name }),
        h("div", { class: "sub", text: physical.id + " | " + table.filename })
      ]),
      h("div", { class: "toolbar-actions" }, [
        h("span", { class: "status " + state.statusKind, text: state.status }),
        h("button", { class: "primary", onclick: saveCurrent, text: "Save" })
      ])
    ]),
    h("div", { class: "content" }, [
      renderTableFields(table, draft),
      renderColumns(table, draft)
    ])
  ]);
}

function renderTableFields(table, draft) {
  return h("section", { class: "section" }, [
    h("h3", { text: "Table enrichment" }),
    textareaField("Description", draft.description || "", (value) => setTableField("description", value), () =>
      requestSuggestion(
        { scope: "table", tableId: table.physical.id, field: "description" },
        table.physical.name + " description",
        (text) => setTableField("description", text)
      )
    ),
    inputField("Aliases", listToInput(draft.aliases), (value) => setTableField("aliases", value), () =>
      requestSuggestion(
        { scope: "table", tableId: table.physical.id, field: "aliases" },
        table.physical.name + " aliases",
        (text) => setTableField("aliases", text)
      )
    ),
    inputField("Primary entity", draft.primaryEntity || "", (value) => setTableField("primaryEntity", value), () =>
      requestSuggestion(
        { scope: "table", tableId: table.physical.id, field: "primaryEntity" },
        table.physical.name + " primary entity",
        (text) => setTableField("primaryEntity", text)
      )
    ),
    inputField("Tags", listToInput(draft.tags), (value) => setTableField("tags", value)),
    textareaField("Common query language", draft.commonQueryLanguage || "", (value) => setTableField("commonQueryLanguage", value), () =>
      requestSuggestion(
        { scope: "table", tableId: table.physical.id, field: "commonQueryLanguage" },
        table.physical.name + " common query language",
        (text) => setTableField("commonQueryLanguage", text)
      )
    ),
    textareaField("Example questions", draft.exampleQuestions || "", (value) => setTableField("exampleQuestions", value))
  ]);
}

function renderColumns(table, draft) {
  return h("section", { class: "section" }, [
    h("h3", { text: "Columns" }),
    h("div", { class: "columns" }, table.physical.columns.map((column) => {
      const columnDraft = draft.columns[column.id] || {};
      const badges = [];
      if (column.primaryKey) badges.push("primary key");
      if (!column.nullable) badges.push("required");
      if (column.sensitive || columnDraft.sensitive) badges.push("sensitive");
      if (table.missingColumnIds.includes(column.id)) badges.push("missing enrichment");
      return h("div", { class: "column" }, [
        h("div", { class: "column-head" }, [
          h("div", {}, [
            h("div", { class: "column-name", text: column.name }),
            h("div", { class: "column-type", text: column.type })
          ]),
          h("div", { class: "badges" }, badges.map((badge) => h("span", { class: "badge", text: badge })))
        ]),
        textareaField("Description", columnDraft.description || "", (value) => setColumnField(column.id, "description", value), () =>
          requestSuggestion(
            { scope: "column", tableId: table.physical.id, columnId: column.id, field: "description" },
            table.physical.name + "." + column.name + " description",
            (text) => setColumnField(column.id, "description", text)
          )
        ),
        inputField("Aliases", listToInput(columnDraft.aliases), (value) => setColumnField(column.id, "aliases", value), () =>
          requestSuggestion(
            { scope: "column", tableId: table.physical.id, columnId: column.id, field: "aliases" },
            table.physical.name + "." + column.name + " aliases",
            (text) => setColumnField(column.id, "aliases", text)
          )
        ),
        inputField("Enum values", listToInput(columnDraft.enum), (value) => setColumnField(column.id, "enum", value))
      ]);
    }))
  ]);
}

function inputField(label, value, onChange, onSuggest) {
  const input = h("input", {
    value,
    oninput: (event) => onChange(event.currentTarget.value)
  });
  return h("div", { class: "field" }, [
    h("label", { text: label }),
    h("div", { class: "field-row" }, [
      input,
      onSuggest ? h("button", { onclick: onSuggest, disabled: state.workspace.aiConfigured ? undefined : "true", text: "AI" }) : null
    ])
  ]);
}

function textareaField(label, value, onChange, onSuggest) {
  const input = h("textarea", {
    oninput: (event) => onChange(event.currentTarget.value)
  });
  input.value = value;
  return h("div", { class: "field" }, [
    h("label", { text: label }),
    h("div", { class: "field-row" }, [
      input,
      onSuggest ? h("button", { onclick: onSuggest, disabled: state.workspace.aiConfigured ? undefined : "true", text: "AI" }) : null
    ])
  ]);
}

function renderTester() {
  const question = h("textarea", { name: "question" });
  question.value = "How many records are in each table?";
  return h("aside", { class: "tester" }, [
    h("div", { class: "tester-head" }, [
      h("h2", { text: "Sample NL question" }),
      h("div", { class: "sub", text: "Model: " + state.workspace.model })
    ]),
    h("div", { class: "tester-body" }, [
      h("form", { onsubmit: askQuestion }, [
        h("div", { class: "field" }, [
          h("label", { text: "Question" }),
          question
        ]),
        h("button", { class: "primary", type: "submit", text: "Generate SQL" })
      ]),
      h("p", { class: "status " + state.askStatusKind, text: state.askStatus }),
      h("pre", { class: "sql", text: state.sql || "-- generated SQL appears here" }),
      state.explain ? h("details", {}, [
        h("summary", { text: "Guardrail explanation" }),
        h("pre", { class: "sql", text: JSON.stringify(state.explain, null, 2) })
      ]) : null
    ])
  ]);
}

function renderSuggestionDialog() {
  const overlay = h("div", { class: "overlay" + (state.suggestions ? " open" : "") });
  if (!state.suggestions) {
    app.append(overlay);
    return;
  }
  overlay.append(h("div", { class: "dialog" }, [
    h("div", { class: "dialog-head" }, [
      h("strong", { text: state.suggestions.title })
    ]),
    h("div", { class: "dialog-body" }, state.suggestions.candidates.length
      ? state.suggestions.candidates.map((candidate) =>
          h("button", {
            class: "candidate",
            onclick: () => {
              state.suggestions.apply(candidate.text);
              state.suggestions = null;
              state.status = "Suggestion applied. Save to write it to disk.";
              state.statusKind = "ok";
              render();
            },
            text: candidate.text
          })
        )
      : [h("p", { text: "No suggestions returned." })]
    ),
    h("div", { class: "dialog-actions" }, [
      h("button", { onclick: () => { state.suggestions = null; render(); }, text: "Close" })
    ])
  ]));
  app.append(overlay);
}

load();
`;
