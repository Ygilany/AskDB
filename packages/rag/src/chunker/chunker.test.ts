import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { chunkSchemaDir, chunkSchema } from "./index.js";
import { loadChunkerSourcesFromDir } from "./sources.js";

const FIXTURE_DIR = resolve(
  __dirname,
  "../../../../fixtures/schemas/orders-users.schema",
);
const GOLDEN_PATH = resolve(FIXTURE_DIR, ".chunks.golden.json");

describe("chunkSchemaDir — determinism + golden snapshot", () => {
  it("produces a stable chunk list for the v2 fixture", () => {
    const result = chunkSchemaDir(FIXTURE_DIR);
    const snapshot = result.chunks.map((c) => ({
      id: c.id,
      type: c.type,
      schemaId: c.schemaId,
      refs: c.refs,
      sensitive: c.sensitive,
      text: c.text,
    }));

    const updateGolden = process.env.UPDATE_RAG_GOLDEN === "1";
    if (updateGolden || !existsSync(GOLDEN_PATH)) {
      writeFileSync(
        GOLDEN_PATH,
        JSON.stringify({ chunks: snapshot }, null, 2) + "\n",
        "utf8",
      );
    }
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as {
      chunks: typeof snapshot;
    };
    expect(snapshot).toEqual(golden.chunks);
  });

  it("two consecutive runs produce byte-identical output", () => {
    const a = chunkSchemaDir(FIXTURE_DIR).chunks;
    const b = chunkSchemaDir(FIXTURE_DIR).chunks;
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("chunks are sorted by id", () => {
    const { chunks } = chunkSchemaDir(FIXTURE_DIR);
    const ids = chunks.map((c) => c.id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  it("emits expected chunk types for the fixture", () => {
    const { stats } = chunkSchemaDir(FIXTURE_DIR);
    expect(stats.byType.table).toBeGreaterThan(0);
    expect(stats.byType.column).toBeGreaterThan(0);
    expect(stats.byType.cql).toBeGreaterThan(0);
    expect(stats.byType.question).toBeGreaterThan(0);
    expect(stats.byType.concept).toBeGreaterThan(0);
  });
});

describe("sensitive propagation", () => {
  it("excludes sensitive column chunks by default", () => {
    const { chunks } = chunkSchemaDir(FIXTURE_DIR);
    expect(chunks.find((c) => c.id === "chunk:table:public.users#email")).toBeUndefined();
    const usersTable = chunks.find((c) => c.id === "chunk:table:public.users");
    expect(usersTable?.text).not.toMatch(/email/);
    expect(usersTable?.refs).not.toContain("table:public.users#email");
  });

  it("excludes business-context chunks that mention a sensitive column", () => {
    // users.md's Business context mentions `email` (the sensitive column).
    const { chunks, stats } = chunkSchemaDir(FIXTURE_DIR);
    expect(stats.sensitiveExcluded).toBeGreaterThan(0);
    const userBiz = chunks.find((c) =>
      c.id.startsWith("chunk:table:public.users#biz"),
    );
    expect(userBiz).toBeUndefined();
  });

  it("`includeSensitiveDescribable: true` flips the exclusion + emits include count", () => {
    const { chunks, stats } = chunkSchemaDir(FIXTURE_DIR, {
      includeSensitiveDescribable: true,
    });
    expect(stats.sensitiveIncluded).toBeGreaterThan(0);
    expect(chunks.find((c) => c.id === "chunk:table:public.users#email")).toBeDefined();
    const userBiz = chunks.find((c) =>
      c.id.startsWith("chunk:table:public.users#biz"),
    );
    expect(userBiz).toBeDefined();
  });
});

describe("long-body splitting", () => {
  it("splits long bodies on paragraph boundaries with `#bc:N` suffixes", () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const longParagraphs = Array.from({ length: 6 }, (_, i) =>
      // ~250-char paragraphs, six of them
      `Paragraph ${i + 1}: ${"x".repeat(240)}`,
    ).join("\n\n");
    // Inject a long Business context for orders to force a split.
    const ordersMd = sources.tables["table:public.orders"];
    expect(ordersMd).toBeDefined();
    ordersMd!.sections["Business context"] = longParagraphs;

    const { chunks } = chunkSchema(sources, { chunkSizeMaxChars: 600 });
    const bcChunks = chunks
      .filter((c) => c.id.startsWith("chunk:table:public.orders#biz"))
      .map((c) => c.id);
    expect(bcChunks.length).toBeGreaterThan(1);
    // First-Nth indexed; exactly the bc:N suffix shape.
    for (let i = 0; i < bcChunks.length; i++) {
      expect(bcChunks[i]).toMatch(/#bc:\d+$/);
    }
  });
});

describe("filter inputs are tolerant", () => {
  it("works on a schema with no concepts.md", () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    sources.concepts = undefined;
    const { stats } = chunkSchema(sources);
    expect(stats.byType.concept).toBe(0);
  });

  it("emits relationship chunks when requested", () => {
    const { chunks } = chunkSchemaDir(FIXTURE_DIR, { emitRelationships: true });
    const rel = chunks.filter((c) => c.type === "relationship");
    expect(rel.length).toBeGreaterThan(0);
  });
});
