import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadSchemaFromJson, readSchemaDirectory } from "./loader.js";
import { parseConceptsMarkdown, parseTableMarkdown } from "./parser.js";
import { parseTenantPolicyMarkdown } from "./tenant-policy-loader.js";
import { writeTableMarkdown } from "./writer.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "../../../../../fixtures/schemas");

// Set only if a front-matter block is run as code.
const SENTINEL = "__askdbFrontMatterRan";
const ran = () => (globalThis as Record<string, unknown>)[SENTINEL];
afterEach(() => {
  delete (globalThis as Record<string, unknown>)[SENTINEL];
});

const CODE = `(globalThis.${SENTINEL} = true, { id: "table:public.orders" })`;
// Every tag gray-matter 4.0.3 maps to a non-YAML engine (its aliases are case-insensitive),
// plus names it would look up on the engine table's prototype and an unregistered one.
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
  it.each(TAGS)("refuses `---%s` front-matter in every parser and runs nothing", (tag, block) => {
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

  it("writeTableMarkdown keeps a body that opens with a `---js` block as text and runs nothing", () => {
    const body = `---js\n${CODE}\n---\nBody.\n`;
    const ordersPath = join(fixtures, "orders-users.schema/tables/orders.md");
    const { frontmatter } = parseTableMarkdown(readFileSync(ordersPath, "utf8"), ordersPath);
    const written = writeTableMarkdown(frontmatter, body);
    expect(ran()).toBeUndefined();
    expect(parseTableMarkdown(written, "x.md").body).toBe(body);
    expect(ran()).toBeUndefined();
  });
});
