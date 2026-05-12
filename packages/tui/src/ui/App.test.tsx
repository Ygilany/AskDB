import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { createElement } from "react";
import { loadSchema } from "@askdb/core";
import { App } from "./App.js";
import { loadWorkspace } from "@askdb/enrich";

const FIXTURE = new URL(
  "../../../../fixtures/schemas/orders-users.schema",
  import.meta.url,
).pathname;

const KEY_DOWN = "[B";
const KEY_ENTER = "\r";
const KEY_CTRL_D = "";
const KEY_BACKSPACE = "";

async function flush(ms = 50): Promise<void> {
  // Ink's render is async; let pending state updates settle.
  await new Promise((r) => setTimeout(r, ms));
}

async function clearField(stdin: { write: (s: string) => void }, length: number): Promise<void> {
  for (let i = 0; i < length; i += 1) stdin.write(KEY_BACKSPACE);
  await flush();
}

describe("App headless author flow", () => {
  let tmp: string;
  let schemaDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "askdb-tui-app-"));
    schemaDir = join(tmp, "orders-users.schema");
    cpSync(FIXTURE, schemaDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("opens the fixture, edits the orders description, saves, and round-trips", async () => {
    const ws = loadWorkspace(schemaDir);
    const { stdin, lastFrame, unmount } = render(createElement(App, { workspace: ws }));
    await flush();
    expect(lastFrame()).toContain("orders-users");
    expect(lastFrame()).toContain("orders");
    expect(lastFrame()).toContain("users");

    // Select orders (second entry) and open it.
    stdin.write(KEY_DOWN);
    await flush();
    stdin.write(KEY_ENTER);
    await flush();
    expect(lastFrame()).toContain("Description");

    // Enter edit mode for the description (field index 0).
    stdin.write(KEY_ENTER);
    await flush();
    // Append a sentinel to confirm typing reaches the editor.
    stdin.write(" Edited.");
    await flush();
    stdin.write(KEY_ENTER);
    await flush();

    // Save.
    stdin.write("s");
    await flush();
    expect(lastFrame()).toContain("Saved");

    // The saved file must round-trip through the Phase 5 writer.
    const saved = readFileSync(join(schemaDir, "tables/orders.md"), "utf8");
    expect(saved).toMatch(/^---/);
    expect(saved).toMatch(/id:\s*['"]?table:public\.orders['"]?/);
    expect(saved).toContain("# Table: orders");
    expect(saved).toContain("Customer purchase orders");
    expect(saved).toContain("Edited.");
    expect(saved).toContain("## Common query language");
    expect(saved).toContain("## Example questions");
    expect(saved).toContain("## Business context");

    // Re-loading the workspace must round-trip the parsed structure.
    const ws2 = loadWorkspace(schemaDir);
    const orders = ws2.tables.find((t) => t.physical.name === "orders")!;
    expect(orders.parsed?.frontmatter.id).toBe("table:public.orders");
    expect(orders.parsed?.sections["Common query language"]).toBeDefined();

    unmount();
  });

  it("edits aliases on the orders table and persists them", async () => {
    const ws = loadWorkspace(schemaDir);
    const { stdin, lastFrame, unmount } = render(createElement(App, { workspace: ws }));
    await flush();
    // Open orders.
    stdin.write(KEY_DOWN);
    await flush();
    stdin.write(KEY_ENTER);
    await flush();

    // Navigate to Aliases (field index 1).
    stdin.write(KEY_DOWN);
    await flush();
    stdin.write(KEY_ENTER); // start editing
    await flush();
    // Append a new alias (cursor sits at end of initial value).
    stdin.write(", revenue_records");
    await flush();
    stdin.write(KEY_ENTER); // submit (single-line)
    await flush();

    // Save.
    stdin.write("s");
    await flush();
    expect(lastFrame()).toContain("Saved");

    const saved = readFileSync(join(schemaDir, "tables/orders.md"), "utf8");
    expect(saved).toContain("revenue_records");
    // Existing aliases preserved.
    expect(saved).toContain("purchases");
    expect(saved).toContain("sales");

    unmount();
  });

  it("submits a table description with Enter and advances to aliases", async () => {
    const ws = loadWorkspace(schemaDir);
    const { stdin, lastFrame, unmount } = render(createElement(App, { workspace: ws }));
    await flush();
    // Open users.
    stdin.write(KEY_ENTER);
    await flush();

    // Edit description, append text, and submit with Enter.
    stdin.write(KEY_ENTER);
    await flush();
    stdin.write(" Enter submitted.");
    await flush();
    stdin.write(KEY_ENTER);
    await flush();

    expect(lastFrame()).toMatch(/▶\s+Aliases/);

    stdin.write("s");
    await flush();
    const saved = readFileSync(join(schemaDir, "tables/users.md"), "utf8");
    expect(saved).toContain("Enter submitted.");
    expect(saved).toMatch(
      /# Table: users\n\nRegistered user accounts\. One row per signed-up user\. Enter submitted\.\n\n## Common query language/,
    );

    unmount();
  });

  it("opens the column edit screen for a non-described column", async () => {
    const ws = loadWorkspace(schemaDir);
    const { stdin, lastFrame, unmount } = render(createElement(App, { workspace: ws }));
    await flush();
    // Open orders.
    stdin.write(KEY_DOWN);
    await flush();
    stdin.write(KEY_ENTER);
    await flush();
    // Table-level fields are 7; column #0 = id (idx 7), col #1 = user_id (idx 8).
    for (let i = 0; i < 8; i += 1) {
      stdin.write(KEY_DOWN);
      await flush();
    }
    expect(lastFrame() ?? "").toMatch(/▶ user_id|▶\s+user_id/);
    stdin.write(KEY_ENTER);
    await flush();
    expect(lastFrame()).toMatch(/user_id\s+\(uuid\)/);
    expect(lastFrame()).toContain("Description");
    expect(lastFrame()).toContain("Aliases");
    unmount();
  });

  it("surfaces a sensitive-column warning when the description mentions one", async () => {
    const ws = loadWorkspace(schemaDir);
    const { stdin, lastFrame, unmount } = render(createElement(App, { workspace: ws }));
    await flush();
    // Open users (selectedIndex defaults to 0).
    stdin.write(KEY_ENTER);
    await flush();
    // Edit description (field 0).
    stdin.write(KEY_ENTER);
    await flush();
    // Append a phrase that mentions the sensitive `email` column.
    stdin.write(" We look up users by email.");
    await flush();
    stdin.write(KEY_ENTER);
    await flush();
    expect(lastFrame()).toMatch(/sensitive column/i);
    expect(lastFrame()).toContain("email");
    unmount();
  });

  it("edits the Common query language section without disturbing other sections", async () => {
    const ws = loadWorkspace(schemaDir);
    const { stdin, unmount } = render(createElement(App, { workspace: ws }));
    await flush();
    // Open orders.
    stdin.write(KEY_DOWN);
    await flush();
    stdin.write(KEY_ENTER);
    await flush();

    // Common query language field.
    for (let i = 0; i < 5; i += 1) {
      stdin.write(KEY_DOWN);
      await flush();
    }
    stdin.write(KEY_ENTER);
    await flush();
    stdin.write(KEY_ENTER);
    await flush();
    stdin.write('- "paid customers" means users with paid orders');
    await flush();
    stdin.write(KEY_CTRL_D);
    await flush();
    stdin.write("s");
    await flush();

    const saved = readFileSync(join(schemaDir, "tables/orders.md"), "utf8");
    expect(saved).toContain('- "paid customers" means users with paid orders');
    expect(saved).toContain("## Example questions");
    expect(saved).toContain("How much revenue did we make last month?");
    expect(saved).toContain("## Business context");
    unmount();
  });

  it("queues an AI suggestion and only persists it after confirmation", async () => {
    const ws = loadWorkspace(schemaDir);
    const suggest = async () => [{ text: "AI suggested order records." }];
    const { stdin, lastFrame, unmount } = render(
      createElement(App, { workspace: ws, suggest }),
    );
    await flush();
    // Open orders.
    stdin.write(KEY_DOWN);
    await flush();
    stdin.write(KEY_ENTER);
    await flush();

    stdin.write("g");
    await flush(100);
    expect(lastFrame()).toContain("AI suggested order records.");

    // Rejecting a suggestion must not mutate the draft or disk.
    stdin.write("r");
    await flush();
    stdin.write("s");
    await flush();
    let saved = readFileSync(join(schemaDir, "tables/orders.md"), "utf8");
    expect(saved).not.toContain("AI suggested order records.");

    // Accepting updates the draft; the explicit save persists it.
    stdin.write("g");
    await flush(100);
    stdin.write(KEY_ENTER);
    await flush();
    stdin.write("s");
    await flush();
    saved = readFileSync(join(schemaDir, "tables/orders.md"), "utf8");
    expect(saved).toContain("AI suggested order records.");

    unmount();
  });

  it("adds a concept and saves a reloadable concepts.md", async () => {
    const ws = loadWorkspace(schemaDir);
    const { stdin, lastFrame, unmount } = render(createElement(App, { workspace: ws }));
    await flush();

    stdin.write("c");
    await flush();
    expect(lastFrame()).toContain("Concepts");

    stdin.write("a");
    await flush();
    stdin.write("concept:vip_customer");
    await flush();
    stdin.write(KEY_ENTER);
    await flush();
    stdin.write("VIP Customer");
    await flush();
    stdin.write(KEY_ENTER);
    await flush();
    stdin.write("vip, high value");
    await flush();
    stdin.write(KEY_ENTER);
    await flush();
    stdin.write("table:public.users");
    await flush();
    stdin.write(KEY_ENTER);
    await flush();
    stdin.write("A customer segment used for retention analysis.");
    await flush();
    stdin.write(KEY_CTRL_D);
    await flush();
    expect(lastFrame()).toContain("Concept queued");
    stdin.write("s");
    await flush();
    expect(lastFrame()).toContain("Saved");

    const saved = readFileSync(join(schemaDir, "concepts.md"), "utf8");
    expect(saved).toContain("concept:vip_customer");
    expect(saved).toContain("VIP Customer");
    const normalized = loadSchema(schemaDir);
    expect(normalized.concepts?.some((c) => c.id === "concept:vip_customer")).toBe(true);
    unmount();
  });

  it("idempotency: viewing without edits leaves files byte-identical", async () => {
    const beforeOrders = readFileSync(join(schemaDir, "tables/orders.md"));
    const beforeUsers = readFileSync(join(schemaDir, "tables/users.md"));

    const ws = loadWorkspace(schemaDir);
    const { stdin, unmount } = render(createElement(App, { workspace: ws }));
    await flush();
    stdin.write(KEY_DOWN);
    await flush();
    stdin.write(KEY_ENTER);
    await flush();
    // Back to list, exit.
    stdin.write("b");
    await flush();
    unmount();

    const afterOrders = readFileSync(join(schemaDir, "tables/orders.md"));
    const afterUsers = readFileSync(join(schemaDir, "tables/users.md"));
    expect(afterOrders.equals(beforeOrders)).toBe(true);
    expect(afterUsers.equals(beforeUsers)).toBe(true);
  });

  it("backspace clears characters in TextInput", async () => {
    const ws = loadWorkspace(schemaDir);
    const { stdin, unmount } = render(createElement(App, { workspace: ws }));
    await flush();
    // Open users.
    stdin.write(KEY_ENTER);
    await flush();
    // Description field. Edit, clear original (~50 chars), type sentinel, save.
    stdin.write(KEY_ENTER);
    await flush();
    await clearField(stdin, 200); // generous count; overshoot is harmless.
    stdin.write("Cleared and replaced.");
    await flush();
    stdin.write(KEY_ENTER);
    await flush();
    stdin.write("s");
    await flush();
    const saved = readFileSync(join(schemaDir, "tables/users.md"), "utf8");
    expect(saved).toContain("Cleared and replaced.");
    expect(saved).not.toContain("Registered user accounts.");
    unmount();
  });
});
