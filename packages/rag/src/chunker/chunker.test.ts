import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { chunkSchemaDir, chunkSchema, chunkIdPrefix } from "./index.js";
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

    if (process.env.UPDATE_RAG_GOLDEN === "1") {
      writeFileSync(
        GOLDEN_PATH,
        JSON.stringify({ chunks: snapshot }, null, 2) + "\n",
        "utf8",
      );
    } else if (!existsSync(GOLDEN_PATH)) {
      throw new Error(
        `Missing RAG chunk golden at ${GOLDEN_PATH}. Regenerate it with ` +
          "UPDATE_RAG_GOLDEN=1 pnpm --filter @askdb/rag exec vitest run --config ../../vitest.config.ts src/chunker/chunker.test.ts " +
          "and commit the file.",
      );
    }
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as {
      chunks: typeof snapshot;
    };
    expect(snapshot).toEqual(golden.chunks);
  });

  it("chunks are sorted by id", () => {
    const { chunks } = chunkSchemaDir(FIXTURE_DIR);
    const ids = chunks.map((c) => c.id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});

describe("sensitive propagation", () => {
  it("excludes sensitive column chunks by default", () => {
    const { chunks } = chunkSchemaDir(FIXTURE_DIR);
    expect(chunks.find((c) => c.id === "chunk:orders-users:table:public.users#email")).toBeUndefined();
    const usersTable = chunks.find((c) => c.id === "chunk:orders-users:table:public.users");
    expect(usersTable?.text).not.toMatch(/email/);
    expect(usersTable?.refs).not.toContain("table:public.users#email");
  });

  it("excludes business-context chunks that mention a sensitive column", () => {
    // users.md's Business context mentions `email` (the sensitive column).
    const { chunks, stats } = chunkSchemaDir(FIXTURE_DIR);
    expect(stats.sensitiveExcluded).toBeGreaterThan(0);
    const userBiz = chunks.find((c) =>
      c.id.startsWith("chunk:orders-users:table:public.users#biz"),
    );
    expect(userBiz).toBeUndefined();
  });

  it("`includeSensitiveDescribable: true` flips the exclusion + emits include count", () => {
    const { chunks, stats } = chunkSchemaDir(FIXTURE_DIR, {
      includeSensitiveDescribable: true,
    });
    expect(stats.sensitiveIncluded).toBeGreaterThan(0);
    expect(chunks.find((c) => c.id === "chunk:orders-users:table:public.users#email")).toBeDefined();
    const userBiz = chunks.find((c) =>
      c.id.startsWith("chunk:orders-users:table:public.users#biz"),
    );
    expect(userBiz).toBeDefined();
  });
});

describe("ignored table propagation", () => {
  it("excludes untracked tables from every RAG chunk type", () => {
    const sources = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const orders = sources.schema.tables.find((table) => table.id === "table:public.orders");
    expect(orders).toBeDefined();
    orders!.tracked = false;

    const { chunks, stats } = chunkSchema(sources, { emitRelationships: true });
    const leaked = chunks.filter((chunk) =>
      chunk.refs.some((ref) => ref === "table:public.orders" || ref.startsWith("table:public.orders#")),
    );

    expect(leaked).toHaveLength(0);
    expect(chunks.find((chunk) => chunk.id === "chunk:orders-users:table:public.orders")).toBeUndefined();
    expect(stats.totalChunks).toBe(chunks.length);
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
      .filter((c) => c.id.startsWith("chunk:orders-users:table:public.orders#biz"))
      .map((c) => c.id);
    expect(bcChunks.length).toBeGreaterThan(1);
    // First-Nth indexed; exactly the bc:N suffix shape.
    for (let i = 0; i < bcChunks.length; i++) {
      expect(bcChunks[i]).toMatch(/#bc:\d+$/);
    }
  });
});

const MULTI_TENANT_DIR = resolve(
  __dirname,
  "../../../../fixtures/schemas/agency-multi-tenant.schema",
);

describe("tenant policy chunking", () => {
  it("emits tenant-policy chunks for the multi-tenant fixture", () => {
    const { chunks, stats } = chunkSchemaDir(MULTI_TENANT_DIR);
    const tpChunks = chunks.filter((c) => c.type === "tenant-policy");
    expect(tpChunks.length).toBeGreaterThan(0);
    expect(stats.byType["tenant-policy"]).toBe(tpChunks.length);
  });

  it("emits one chunk per H2 section", () => {
    const { chunks } = chunkSchemaDir(MULTI_TENANT_DIR);
    const tpChunks = chunks.filter((c) => c.type === "tenant-policy");
    const ids = tpChunks.map((c) => c.id);
    expect(ids).toContain("chunk:agency-multi-tenant:tenant-policy#hierarchy");
    expect(ids).toContain("chunk:agency-multi-tenant:tenant-policy#scope-rules");
    expect(ids).toContain("chunk:agency-multi-tenant:tenant-policy#sensitive-interactions");
  });

  it("chunk text includes section heading and body", () => {
    const { chunks } = chunkSchemaDir(MULTI_TENANT_DIR);
    const hierarchy = chunks.find((c) => c.id === "chunk:agency-multi-tenant:tenant-policy#hierarchy");
    expect(hierarchy).toBeDefined();
    expect(hierarchy!.text).toContain("Tenant policy — Hierarchy");
    expect(hierarchy!.text).toContain("Agencies");
  });

  it("tenant-policy chunks are not sensitive", () => {
    const { chunks } = chunkSchemaDir(MULTI_TENANT_DIR);
    const tpChunks = chunks.filter((c) => c.type === "tenant-policy");
    for (const c of tpChunks) {
      expect(c.sensitive).toBe(false);
    }
  });

  it("does not emit tenant-policy chunks when schema has no tenant policy", () => {
    const { chunks, stats } = chunkSchemaDir(FIXTURE_DIR);
    const tpChunks = chunks.filter((c) => c.type === "tenant-policy");
    expect(tpChunks).toHaveLength(0);
    expect(stats.byType["tenant-policy"]).toBe(0);
  });

  it("tenant-policy chunks are deterministic across runs", () => {
    const a = chunkSchemaDir(MULTI_TENANT_DIR).chunks.filter((c) => c.type === "tenant-policy");
    const b = chunkSchemaDir(MULTI_TENANT_DIR).chunks.filter((c) => c.type === "tenant-policy");
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
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

describe("schema-scoped chunk ids", () => {
  it("prefixes every chunk id with `chunk:<schemaId>:`", () => {
    const { chunks } = chunkSchemaDir(FIXTURE_DIR, { emitRelationships: true });
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.id.startsWith(chunkIdPrefix("orders-users"))).toBe(true);
      expect(c.schemaId).toBe("orders-users");
    }
    expect(chunks.map((c) => c.id)).toContain(
      "chunk:orders-users:table:public.orders#cql",
    );
  });

  it("two schemas with the same tables produce disjoint ids", () => {
    const a = loadChunkerSourcesFromDir(FIXTURE_DIR);
    const b = loadChunkerSourcesFromDir(FIXTURE_DIR);
    b.schema.schemaId = "orders-users-copy";
    const idsA = new Set(chunkSchema(a).chunks.map((c) => c.id));
    const idsB = chunkSchema(b).chunks.map((c) => c.id);
    expect(idsB.some((id) => idsA.has(id))).toBe(false);
  });
});

describe("sensitive-mention filtering", () => {
  function sources() {
    return loadChunkerSourcesFromDir(FIXTURE_DIR);
  }
  function table(s: ReturnType<typeof sources>, id: string) {
    const t = s.schema.tables.find((x) => x.id === id);
    expect(t).toBeDefined();
    return t!;
  }

  it("matches sensitive column names case-insensitively in concepts", () => {
    const s = sources();
    s.concepts!.frontmatter.concepts!.push({
      id: "concept:contactability",
      label: "Contactability",
      description: "Filter by EMAIL domain to find reachable customers.",
    });
    const excluded = chunkSchema(s);
    expect(
      excluded.chunks.find((c) => c.id === "chunk:orders-users:concept:contactability"),
    ).toBeUndefined();

    const included = chunkSchema(s, { includeSensitiveDescribable: true });
    const chunk = included.chunks.find(
      (c) => c.id === "chunk:orders-users:concept:contactability",
    );
    expect(chunk?.text).toContain("EMAIL domain");
    expect(chunk?.sensitive).toBe(true);
    expect(included.stats.sensitiveIncluded).toBeGreaterThan(excluded.stats.sensitiveIncluded);
  });

  it("checks concept labels and synonyms, not just descriptions", () => {
    const s = sources();
    s.concepts!.frontmatter.concepts!.push({
      id: "concept:reach",
      label: "Reach",
      synonyms: ["Email reach"],
    });
    expect(
      chunkSchema(s).chunks.find((c) => c.id === "chunk:orders-users:concept:reach"),
    ).toBeUndefined();
  });

  it("matches case-insensitively in common query language", () => {
    const s = sources();
    table(s, "table:public.users").commonQueryLanguage = "Customers are reached via Email.";
    const { chunks } = chunkSchema(s);
    expect(
      chunks.find((c) => c.id.startsWith("chunk:orders-users:table:public.users#cql")),
    ).toBeUndefined();
  });

  it("drops table description / aliases that name a sensitive column", () => {
    const s = sources();
    const users = table(s, "table:public.users");
    users.description = "Registered users keyed by their Email address.";
    users.aliases = ["accounts", "email list"];
    const { chunks } = chunkSchema(s);
    const chunk = chunks.find((c) => c.id === "chunk:orders-users:table:public.users");
    expect(chunk).toBeDefined();
    expect(chunk!.text).not.toMatch(/email/i);
    expect(chunk!.text).toContain("Aliases: accounts");
    expect(chunk!.sensitive).toBe(false);

    const optIn = chunkSchema(s, { includeSensitiveDescribable: true }).chunks.find(
      (c) => c.id === "chunk:orders-users:table:public.users",
    );
    expect(optIn!.text).toContain("Email address");
    expect(optIn!.sensitive).toBe(true);
  });

  it("drops the describable layer of a non-sensitive column that names a sensitive column", () => {
    const s = sources();
    const users = table(s, "table:public.users");
    const createdAt = users.columns.find((c) => c.name === "created_at")!;
    createdAt.description = "Set when the EMAIL is first verified.";
    const { chunks } = chunkSchema(s);
    const colChunk = chunks.find(
      (c) => c.id === "chunk:orders-users:table:public.users#created_at",
    );
    // Identifier + type are kept; the describable text is not.
    expect(colChunk).toBeDefined();
    expect(colChunk!.text).toContain("public.users.created_at");
    expect(colChunk!.text).not.toMatch(/email/i);
    const tableChunk = chunks.find((c) => c.id === "chunk:orders-users:table:public.users");
    expect(tableChunk!.text).not.toMatch(/email/i);

    const optIn = chunkSchema(s, { includeSensitiveDescribable: true }).chunks.find(
      (c) => c.id === "chunk:orders-users:table:public.users#created_at",
    );
    expect(optIn!.text).toContain("EMAIL is first verified");
    expect(optIn!.sensitive).toBe(true);
  });

  it("treats relationship chunks touching a sensitive column as sensitive", () => {
    const s = sources();
    const users = table(s, "table:public.users");
    users.columns.find((c) => c.name === "id")!.sensitive = true;
    const { chunks } = chunkSchema(s, { emitRelationships: true });
    expect(chunks.filter((c) => c.type === "relationship")).toHaveLength(0);

    const optIn = chunkSchema(s, {
      emitRelationships: true,
      includeSensitiveDescribable: true,
    }).chunks.filter((c) => c.type === "relationship");
    expect(optIn).toHaveLength(1);
    expect(optIn[0].sensitive).toBe(true);
  });
});
