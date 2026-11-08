import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { synthesizeRetrievedDdl } from "@askdb/core";
import { chunkSchema } from "./chunker/index.js";
import { loadChunkerSourcesFromDir } from "./chunker/sources.js";
import type { Chunk } from "./types.js";

// The seam between the chunker and the prompt: a chunk retrieval picks must
// put the text it carries into the prompt `ask()` sends (#894).

const FIXTURE_DIR = resolve(__dirname, "../../../fixtures/schemas/orders-users.schema");
const TENANT_FIXTURE_DIR = resolve(__dirname, "../../../fixtures/schemas/agency-multi-tenant.schema");

const tmpRoots: string[] = [];
afterEach(() => {
  for (const root of tmpRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** The fixture, copied so a test can add a section to `tables/orders.md`. */
function fixtureWithOrdersSection(section: string): string {
  const root = mkdtempSync(join(tmpdir(), "askdb-rag-prompt-"));
  tmpRoots.push(root);
  const dir = join(root, "orders-users.schema");
  cpSync(FIXTURE_DIR, dir, { recursive: true });
  appendFileSync(join(dir, "tables/orders.md"), `\n${section}\n`);
  return dir;
}

/** The prompt's schema block when retrieval returns exactly `picked`. */
function promptFor(dir: string, picked: Chunk[], omitSensitiveIdentifiersFromPrompt = false): string {
  const { schema } = loadChunkerSourcesFromDir(dir);
  const { ddl } = synthesizeRetrievedDdl({
    schema,
    results: picked.map((payload) => ({ id: payload.id, score: 1, payload })),
    omitSensitiveIdentifiersFromPrompt,
  });
  return ddl;
}

/** Whitespace-insensitive, so a renderer may rewrap the text. */
function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

describe("retrieved chunks reach the prompt (#894)", () => {
  it("puts a retrieved Business context chunk's text in the prompt", () => {
    const { chunks } = chunkSchema(loadChunkerSourcesFromDir(FIXTURE_DIR));
    const biz = chunks.filter((c) => c.id === "chunk:orders-users:table:public.orders#biz");
    expect(biz).toHaveLength(1);

    const prompt = flat(promptFor(FIXTURE_DIR, biz));

    expect(prompt).toContain("TABLE public.orders");
    expect(prompt).toContain(
      flat("Orders move through `pending → paid → shipped` and may end in `cancelled`. The `total_amount` column is stored in cents."),
    );
  });

  it("puts every part of a long Business context body in the prompt", () => {
    const dir = fixtureWithOrdersSection(
      "## Business context\n\nRefunds are recorded as new orders with a negative total.\n\nTest accounts place orders with status `pending` only.",
    );
    const { chunks } = chunkSchema(loadChunkerSourcesFromDir(dir), { chunkSizeMaxChars: 60 });
    const parts = chunks.filter((c) => c.id.startsWith("chunk:orders-users:table:public.orders#biz#bc:"));
    expect(parts).toHaveLength(2);

    const prompt = flat(promptFor(dir, parts));

    expect(prompt).toContain("Refunds are recorded as new orders with a negative total.");
    expect(prompt).toContain(flat("Test accounts place orders with status `pending` only."));
  });

  it("puts a retrieved column chunk's Column notes line in the prompt", () => {
    const dir = fixtureWithOrdersSection("## Column notes\n\n- `status`: refunds flip a paid order back to pending");
    const { chunks } = chunkSchema(loadChunkerSourcesFromDir(dir));
    const column = chunks.filter((c) => c.id === "chunk:orders-users:table:public.orders#status");
    expect(column).toHaveLength(1);
    expect(column[0]!.text).toContain("refunds flip a paid order back to pending");

    const prompt = flat(promptFor(dir, column));

    expect(prompt).toContain("refunds flip a paid order back to pending");
  });

  it("keeps a retrieved concept's label", () => {
    const { chunks } = chunkSchema(loadChunkerSourcesFromDir(FIXTURE_DIR));
    const concept = chunks.filter((c) => c.id === "chunk:orders-users:concept:revenue");
    expect(concept).toHaveLength(1);

    expect(promptFor(FIXTURE_DIR, concept)).toContain("-- Concept: Revenue; Id: concept:revenue;");
  });

  it("keeps a retrieved tenant-policy section's heading", () => {
    const { chunks } = chunkSchema(loadChunkerSourcesFromDir(TENANT_FIXTURE_DIR));
    const sections = chunks.filter((c) => c.type === "tenant-policy");
    expect(sections.length).toBeGreaterThan(1);

    const prompt = promptFor(TENANT_FIXTURE_DIR, sections);

    expect(prompt).toContain("-- Tenant policy — Hierarchy; ");
    expect(prompt).toContain("-- Tenant policy — Scope rules; ");
  });

  it("withholds an opt-in index's business context that names a sensitive column when omission is on", () => {
    // users.email is sensitive and the users Business context names it: only an opt-in index keeps it, flagged.
    const { chunks } = chunkSchema(loadChunkerSourcesFromDir(FIXTURE_DIR), { includeSensitiveDescribable: true });
    const biz = chunks.filter((c) => c.id === "chunk:orders-users:table:public.users#biz");
    expect(biz).toHaveLength(1);
    expect(biz[0]!.sensitive).toBe(true);

    expect(flat(promptFor(FIXTURE_DIR, biz, true))).not.toContain("unique email address");
    expect(flat(promptFor(FIXTURE_DIR, biz, false))).toContain("Each user has a unique email address used for login.");
  });
});
