import { afterEach, describe, expect, it } from "vitest";
import { dirname, join, resolve } from "node:path";
import type { ParsedTenantPolicyMarkdown } from "@askdb/core";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
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

describe("front-matter sensitivity escalation (core loader)", () => {
  it("excludes a column that only table front-matter marks sensitive", () => {
    const root = mkdtempSync(join(tmpdir(), "askdb-rag-sensitivity-"));
    try {
      const dir = join(root, "orders-users.schema");
      cpSync(FIXTURE_DIR, dir, { recursive: true });
      const ordersMd = join(dir, "tables", "orders.md");
      writeFileSync(
        ordersMd,
        readFileSync(ordersMd, "utf8").replace(
          "    enum: [pending, paid, shipped, cancelled]\n",
          "    enum: [pending, paid, shipped, cancelled]\n    sensitive: true\n",
        ),
      );

      // Control: schema.json marks orders.status non-sensitive, so it is chunked by default.
      expect(
        chunkSchemaDir(FIXTURE_DIR).chunks.find((c) => c.id === "chunk:orders-users:table:public.orders#status"),
      ).toBeDefined();

      const { chunks } = chunkSchemaDir(dir);
      expect(chunks.find((c) => c.id === "chunk:orders-users:table:public.orders#status")).toBeUndefined();
      const ordersTable = chunks.find((c) => c.id === "chunk:orders-users:table:public.orders");
      expect(ordersTable?.refs).not.toContain("table:public.orders#status");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
    const { chunks } = chunkSchemaDir(MULTI_TENANT_DIR, { includeSensitiveDescribable: true });
    const tpChunks = chunks.filter((c) => c.type === "tenant-policy");
    const ids = tpChunks.map((c) => c.id);
    expect(ids).toContain("chunk:agency-multi-tenant:tenant-policy#hierarchy");
    expect(ids).toContain("chunk:agency-multi-tenant:tenant-policy#scope-rules");
    expect(ids).toContain("chunk:agency-multi-tenant:tenant-policy#sensitive-interactions");
  });

  it("excludes a section that names a sensitive column unless opted in", () => {
    // "Sensitive interactions" names the sensitive `clients.email` / `clients.phone` columns.
    const sectionId = "chunk:agency-multi-tenant:tenant-policy#sensitive-interactions";
    const { chunks } = chunkSchemaDir(MULTI_TENANT_DIR);
    const tpChunks = chunks.filter((c) => c.type === "tenant-policy");
    expect(tpChunks.map((c) => c.id)).toContain("chunk:agency-multi-tenant:tenant-policy#hierarchy");
    expect(tpChunks.filter((c) => /PII columns/.test(c.text))).toEqual([]);

    const optIn = chunkSchemaDir(MULTI_TENANT_DIR, { includeSensitiveDescribable: true });
    const section = optIn.chunks.find((c) => c.id === sectionId);
    expect(section?.text).toContain("PII columns (`email`, `phone`)");
    expect(section?.sensitive).toBe(true);
  });

  it("chunk text includes section heading and body", () => {
    const { chunks } = chunkSchemaDir(MULTI_TENANT_DIR);
    const hierarchy = chunks.find((c) => c.id === "chunk:agency-multi-tenant:tenant-policy#hierarchy");
    expect(hierarchy).toBeDefined();
    expect(hierarchy!.text).toContain("Tenant policy — Hierarchy");
    expect(hierarchy!.text).toContain("Agencies");
  });

  it("tenant-policy chunks are not sensitive by default", () => {
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

  it("keeps ids disjoint when a schema id contains `:`", () => {
    // Unencoded, `shop` + `concept:eu:concept:tax` and `shop:concept:eu` +
    // `concept:tax` would both be `chunk:shop:concept:eu:concept:tax`.
    const a = loadChunkerSourcesFromDir(FIXTURE_DIR);
    a.schema.schemaId = "shop";
    a.concepts!.frontmatter.concepts = [{ id: "concept:eu:concept:tax", label: "EU tax" }];
    const b = loadChunkerSourcesFromDir(FIXTURE_DIR);
    b.schema.schemaId = "shop:concept:eu";
    b.concepts!.frontmatter.concepts = [{ id: "concept:tax", label: "Tax" }];

    const idsA = chunkSchema(a).chunks.map((c) => c.id);
    const idsB = chunkSchema(b).chunks.map((c) => c.id);
    expect(idsB.filter((id) => idsA.includes(id))).toEqual([]);
    expect(idsB.filter((id) => id.startsWith(chunkIdPrefix("shop")))).toEqual([]);
    expect(idsB).toContain("chunk:shop%3Aconcept%3Aeu:concept:tax");
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

  // Each case puts text naming the sensitive `users.email` column (in a
  // different case than the column name) into one describable source. By
  // default no chunk of any kind may embed it; opt-in embeds it in the named
  // chunk, flagged sensitive.
  it.each<{
    source: string;
    mutate: (s: ReturnType<typeof sources>) => void;
    marker: RegExp;
    optInId: string;
    /** A chunk that must still be emitted by default (only the text is dropped). */
    keptId?: string;
    /** Increase of `stats.sensitiveExcluded` over the unmodified fixture. */
    excludedDelta: number;
  }>([
    {
      source: "concept description",
      mutate: (s) =>
        s.concepts!.frontmatter.concepts!.push({
          id: "concept:contactability",
          label: "Contactability",
          description: "Filter by EMAIL domain to find reachable customers.",
        }),
      marker: /EMAIL domain/,
      optInId: "chunk:orders-users:concept:contactability",
      excludedDelta: 1,
    },
    {
      source: "concept label",
      mutate: (s) =>
        s.concepts!.frontmatter.concepts!.push({ id: "concept:reach", label: "Email reach" }),
      marker: /Email reach/,
      optInId: "chunk:orders-users:concept:reach",
      excludedDelta: 1,
    },
    {
      source: "concept synonym",
      mutate: (s) =>
        s.concepts!.frontmatter.concepts!.push({
          id: "concept:reach",
          label: "Reach",
          synonyms: ["Email reach"],
        }),
      marker: /Email reach/,
      optInId: "chunk:orders-users:concept:reach",
      excludedDelta: 1,
    },
    {
      source: "common query language body",
      mutate: (s) => {
        table(s, "table:public.users").commonQueryLanguage = "Customers are reached via Email.";
      },
      marker: /reached via Email/,
      optInId: "chunk:orders-users:table:public.users#cql",
      excludedDelta: 1,
    },
    {
      source: "table description",
      mutate: (s) => {
        table(s, "table:public.users").description = "Registered users keyed by their Email address.";
      },
      marker: /Email address/,
      optInId: "chunk:orders-users:table:public.users",
      keptId: "chunk:orders-users:table:public.users",
      excludedDelta: 1,
    },
    {
      source: "description of another table",
      mutate: (s) => {
        table(s, "table:public.orders").description = "Receipts go to the buyer's Email address.";
      },
      marker: /buyer's Email/,
      optInId: "chunk:orders-users:table:public.orders",
      keptId: "chunk:orders-users:table:public.orders",
      excludedDelta: 1,
    },
    {
      source: "common query language body of another table",
      mutate: (s) => {
        table(s, "table:public.orders").commonQueryLanguage = "Join users to send receipts by Email.";
      },
      marker: /receipts by Email/,
      optInId: "chunk:orders-users:table:public.orders#cql",
      excludedDelta: 1,
    },
    {
      source: "table alias (common query language heading)",
      mutate: (s) => {
        table(s, "table:public.users").aliases = ["accounts", "Email list"];
      },
      marker: /Email list/,
      optInId: "chunk:orders-users:table:public.users#cql",
      keptId: "chunk:orders-users:table:public.users#cql",
      // The table chunk and the common query language chunk each drop it.
      excludedDelta: 2,
    },
    {
      source: "primary entity (example question heading)",
      mutate: (s) => {
        table(s, "table:public.users").primaryEntity = "Email subscriber";
      },
      marker: /Email subscriber/,
      optInId: "chunk:orders-users:table:public.users#q:1",
      keptId: "chunk:orders-users:table:public.users#q:1",
      // The table chunk and both example-question chunks each drop it.
      excludedDelta: 3,
    },
  ])("keeps a $source that names a sensitive column out of every chunk", (c) => {
    const baseline = chunkSchema(sources());
    const s = sources();
    c.mutate(s);

    const excluded = chunkSchema(s);
    expect(excluded.chunks.filter((chunk) => c.marker.test(chunk.text))).toEqual([]);
    if (c.keptId) expect(excluded.chunks.map((chunk) => chunk.id)).toContain(c.keptId);
    expect(excluded.stats.sensitiveExcluded - baseline.stats.sensitiveExcluded).toBe(c.excludedDelta);

    const optIn = chunkSchema(s, { includeSensitiveDescribable: true });
    const chunk = optIn.chunks.find((x) => x.id === c.optInId);
    expect(chunk?.text).toMatch(c.marker);
    expect(chunk?.sensitive).toBe(true);
  });

  it.each<[string, (s: ReturnType<typeof sources>) => void]>([
    [
      "an example question names a sensitive column",
      (s) => {
        s.tables["table:public.users"]!.sections["Example questions"] =
          "- How many users signed up last month?\n- Which users have an Email on file?";
      },
    ],
    [
      "a whole table is sensitive",
      (s) => {
        table(s, "table:public.orders").sensitive = true;
      },
    ],
  ])("in opt-in mode, counts and flags every chunk the default leaves out or trims when %s", (_case, mutate) => {
    const s = sources();
    mutate(s);
    const optIn = chunkSchema(s, { includeSensitiveDescribable: true });
    const flagged = optIn.chunks.filter((c) => c.sensitive);
    expect(flagged.length).toBeGreaterThan(0);
    expect(optIn.stats.sensitiveIncluded).toBe(flagged.length);
    // Every chunk the default leaves out is flagged in opt-in mode.
    const defaultIds = new Set(chunkSchema(s).chunks.map((c) => c.id));
    const leftOut = optIn.chunks.filter((c) => !defaultIds.has(c.id));
    expect(leftOut.filter((c) => !c.sensitive)).toEqual([]);
  });

  describe("a column sensitive only through its table (ADR 0017)", () => {
    const tempDirs: string[] = [];
    afterEach(() => {
      while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
    });
    /** The fixture, loaded with `orders` marked sensitive in schema.json and `status` escalated in front-matter. */
    function loadWithSensitiveOrders() {
      const dir = join(mkdtempSync(join(tmpdir(), "askdb-rag-adr17-")), "orders-users.schema");
      tempDirs.push(dirname(dir));
      cpSync(FIXTURE_DIR, dir, { recursive: true });
      const jsonPath = join(dir, "schema.json");
      const json = JSON.parse(readFileSync(jsonPath, "utf8")) as { tables: { id: string; sensitive?: boolean }[] };
      json.tables.find((t) => t.id === "table:public.orders")!.sensitive = true;
      writeFileSync(jsonPath, JSON.stringify(json));
      const mdPath = join(dir, "tables", "orders.md");
      writeFileSync(
        mdPath,
        readFileSync(mdPath, "utf8").replace("  - id: table:public.orders#status\n", "  - id: table:public.orders#status\n    sensitive: true\n"),
      );
      return loadChunkerSourcesFromDir(dir);
    }
    const concept = (id: string, description: string) => ({ id, label: id.slice("concept:".length), description });

    it("counts as `table.column` in any quoting, not by its bare name", () => {
      const s = loadWithSensitiveOrders();
      s.concepts!.frontmatter.concepts = [
        concept("concept:bare", "Count signups grouped by id."),
        concept("concept:dotted", "Read public.orders.total_amount for revenue."),
        concept("concept:double-quoted", 'Read "orders"."total_amount" for revenue.'),
        concept("concept:bracketed", "Read [orders].[total_amount] for revenue."),
        concept("concept:backticked", "Read `orders`.`total_amount` for revenue."),
      ];
      const ids = chunkSchema(s).chunks.map((c) => c.id);
      expect(ids).toContain("chunk:orders-users:concept:bare");
      for (const kind of ["dotted", "double-quoted", "bracketed", "backticked"]) {
        expect(ids).not.toContain(`chunk:orders-users:concept:${kind}`);
      }
    });

    it("still counts by bare name when marked itself, including by front-matter", () => {
      const s = loadWithSensitiveOrders();
      s.concepts!.frontmatter.concepts = [
        concept("concept:by-status", "Count orders grouped by status."),
        concept("concept:reach", "Customers we can Email."),
      ];
      const ids = chunkSchema(s).chunks.map((c) => c.id);
      expect(ids).not.toContain("chunk:orders-users:concept:by-status");
      expect(ids).not.toContain("chunk:orders-users:concept:reach");
    });

    it("keeps a tenant policy section that names it bare, and drops one that names it qualified", () => {
      const s = loadWithSensitiveOrders();
      s.tenantPolicy = {
        frontmatter: {} as ParsedTenantPolicyMarkdown["frontmatter"],
        body: "",
        sections: {
          Hierarchy: "Each user belongs to one org; filter every read by id.",
          "Scope rules": "Never return orders.user_id outside the caller's org.",
        },
      };
      const ids = chunkSchema(s).chunks.map((c) => c.id);
      expect(ids).toContain("chunk:orders-users:tenant-policy#hierarchy");
      expect(ids).not.toContain("chunk:orders-users:tenant-policy#scope-rules");
    });

    it("drops another table's text that names it qualified", () => {
      const s = loadWithSensitiveOrders();
      table(s, "table:public.users").description = "Lifetime value is the sum of orders.total_amount.";
      const usersChunk = chunkSchema(s).chunks.find((c) => c.id === "chunk:orders-users:table:public.users");
      expect(usersChunk!.text).not.toMatch(/Lifetime value/);
    });
  });

  it("counts a sensitive source that splits into several chunks once per chunk", () => {
    const opts = { chunkSizeMaxChars: 40 };
    const optInOpts = { ...opts, includeSensitiveDescribable: true };
    const baseline = chunkSchema(sources(), opts);
    const baselineOptIn = chunkSchema(sources(), optInOpts);
    const s = sources();
    table(s, "table:public.users").commonQueryLanguage = [
      "Customers are reached via Email.",
      "Active means a login in the last 30 days.",
      "Churned means no order in a year.",
    ].join("\n\n");

    const optIn = chunkSchema(s, optInOpts);
    const parts = optIn.chunks.filter((c) => c.id.startsWith("chunk:orders-users:table:public.users#cql"));
    expect(parts).toHaveLength(3);
    expect(optIn.stats.sensitiveIncluded - baselineOptIn.stats.sensitiveIncluded).toBe(3);
    expect(chunkSchema(s, opts).stats.sensitiveExcluded - baseline.stats.sensitiveExcluded).toBe(3);
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
