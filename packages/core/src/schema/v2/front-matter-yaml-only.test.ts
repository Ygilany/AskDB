import { readFileSync } from "node:fs";
import matter from "gray-matter";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { SchemaParseError } from "../../errors.js";
import { loadSchemaFromJson, readSchemaDirectory } from "./loader.js";
import { parseConceptsMarkdown, parseTableMarkdown } from "./parser.js";
import { parseTenantPolicyMarkdown } from "./tenant-policy-loader.js";
import { writeTableMarkdown } from "./writer.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "../../../../../fixtures/schemas");

// Stays unset unless a front-matter block runs.
const SENTINEL = "__askdbFrontMatterRan";
const ran = () => (globalThis as Record<string, unknown>)[SENTINEL];
afterEach(() => {
  delete (globalThis as Record<string, unknown>)[SENTINEL];
});

const CODE = `(globalThis.${SENTINEL} = true, { id: "table:public.orders" })`;
// Every non-YAML format tag gray-matter 4.0.3 reads (its aliases are case-insensitive), names
// it would find on an object's prototype, and one it doesn't know.
const TAGS: ReadonlyArray<[string, string]> = [
  ["js", CODE],
  ["JS", CODE],
  ["Js", CODE],
  [" js ", CODE],
  ["javascript", CODE],
  ["JavaScript", CODE],
  ["json", `{"id": "table:public.orders"}`],
  ["JSON", `{"id": "table:public.orders"}`],
  ["coffee", CODE],
  ["coffeescript", CODE],
  ["cson", CODE],
  ["constructor", CODE],
  ["toString", CODE],
  ["valueOf", CODE],
  ["__proto__", CODE],
  ["toml", "id = 'table:public.orders'"],
];
const PARSERS = [
  ["table", parseTableMarkdown],
  ["concepts", parseConceptsMarkdown],
  ["tenant-policy", parseTenantPolicyMarkdown],
] as const;

describe("schema markdown front-matter is YAML only", () => {
  it.each(TAGS)("refuses `---%s` front-matter in every parser", (tag, block) => {
    const content = `---${tag}\n${block}\n---\nBody.\n`;
    for (const [kind, parse] of PARSERS) {
      expect(() => parse(content, "x.md")).toThrow(new RegExp(`^Malformed ${kind} front-matter YAML in x\\.md: `));
    }
    expect(ran()).toBeUndefined();
  });

  it.each(["", "yaml", "YAML", "yml", " yaml "])("still reads `---%s` front-matter as YAML", (tag) => {
    const parsed = parseConceptsMarkdown(`---${tag}\nconcepts: []\n---\nBody.\n`, "x.md");
    expect(parsed.frontmatter).toEqual({ concepts: [] });
  });

  it.each([
    ["tables", "orders-users.schema"],
    ["concepts", "orders-users.schema"],
    ["tenantPolicy", "agency-multi-tenant.schema"],
  ] as const)("loadSchemaFromJson refuses a bundle whose %s file has `---js` front-matter", (field, dir) => {
    const bundle = readSchemaDirectory(join(fixtures, dir));
    const hostile = `---js\n${CODE}\n---\nBody.\n`;
    const tampered =
      field === "tables"
        ? { ...bundle, tables: { ...bundle.tables, [Object.keys(bundle.tables)[0]!]: hostile } }
        : { ...bundle, [field]: hostile };
    expect(() => loadSchemaFromJson(JSON.stringify(tampered))).toThrow(/Malformed [a-z-]+ front-matter YAML/);
    expect(ran()).toBeUndefined();
  });

  it("writeTableMarkdown keeps a body that opens with a non-YAML block as text", () => {
    const body = `---js\n${CODE}\n---\nBody.\n`;
    const ordersPath = join(fixtures, "orders-users.schema/tables/orders.md");
    const { frontmatter } = parseTableMarkdown(readFileSync(ordersPath, "utf8"), ordersPath);
    const written = writeTableMarkdown(frontmatter, body);
    expect(ran()).toBeUndefined();
    expect(parseTableMarkdown(written, "x.md").body).toBe(body);
    expect(ran()).toBeUndefined();
  });

  it("refuses a format tag before gray-matter reads the block, even a format registered on it", () => {
    const engines = (matter as unknown as { engines: Record<string, unknown> }).engines;
    engines.ini = () => {
      (globalThis as Record<string, unknown>)[SENTINEL] = true;
      return { id: "table:public.orders" };
    };
    try {
      expect(() => parseTableMarkdown("---ini\nid=table:public.orders\n---\nBody.\n", "x.md")).toThrow(
        /^Malformed table front-matter YAML in x\.md: /,
      );
      expect(ran()).toBeUndefined();
    } finally {
      delete engines.ini;
    }
  });

  // The loader refuses a bundle entry that isn't text before parsing it (loader.test.ts, #797);
  // this is the guard for a host that calls parseTableMarkdown() itself.
  it("parseTableMarkdown refuses a table file that isn't text", () => {
    const notText = { content: "---\n---\n", data: { id: "table:public.orders", aliases: ["x"] } };
    const parse = () => parseTableMarkdown(notText as unknown as string, "orders.md");
    expect(parse).toThrow(SchemaParseError);
    expect(parse).toThrow("Malformed table front-matter YAML in orders.md: expected the file's text");
  });
});
