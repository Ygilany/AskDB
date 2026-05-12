import { describe, expect, it } from "vitest";
import { parseTableMarkdown } from "@askdb/core";
import {
  buildFrontmatter,
  buildTableDraft,
  findSensitiveColumnReferences,
  parseListInput,
  isEnumCandidate,
} from "./draft.js";

const physical = {
  id: "table:public.orders",
  name: "orders",
  schema: "public",
  sensitive: false,
  columns: [
    { id: "table:public.orders#id", name: "id", type: "uuid", nullable: false, primaryKey: true, sensitive: false },
    { id: "table:public.orders#email", name: "email", type: "text", nullable: false, sensitive: true },
    { id: "table:public.orders#status", name: "status", type: "text", nullable: false, sensitive: false },
    { id: "table:public.orders#total", name: "total", type: "integer", nullable: false, sensitive: false },
  ],
} as const;

describe("draft", () => {
  it("parseListInput trims and drops empties", () => {
    expect(parseListInput("a, b ,, c,")).toEqual(["a", "b", "c"]);
    expect(parseListInput("")).toEqual([]);
  });

  it("isEnumCandidate identifies text-y types", () => {
    expect(isEnumCandidate({ ...physical.columns[2], type: "text" })).toBe(true);
    expect(isEnumCandidate({ ...physical.columns[2], type: "varchar(50)" })).toBe(true);
    expect(isEnumCandidate({ ...physical.columns[0], type: "uuid" })).toBe(false);
    expect(isEnumCandidate({ ...physical.columns[3], type: "integer" })).toBe(false);
  });

  it("buildTableDraft round-trips through buildFrontmatter via the writer", () => {
    const md = `---
id: table:public.orders
name: orders
schemaId: orders-users
primaryEntity: order
aliases: [purchases, sales]
tags: [revenue]
columns:
  - id: table:public.orders#status
    aliases: [order_status]
    enum: [pending, paid]
    description: Order state.
---

# Table: orders

Customer purchase orders.
`;
    const parsed = parseTableMarkdown(md);
    const draft = buildTableDraft(physical as never, parsed);
    expect(draft.description).toBe("Customer purchase orders.");
    expect(draft.aliases).toEqual(["purchases", "sales"]);
    expect(draft.primaryEntity).toBe("order");
    expect(draft.tags).toEqual(["revenue"]);
    expect(draft.columns["table:public.orders#status"]?.aliases).toEqual(["order_status"]);
    expect(draft.columns["table:public.orders#status"]?.enum).toEqual(["pending", "paid"]);

    const rebuilt = buildFrontmatter(physical as never, "orders-users", draft);
    expect(rebuilt.aliases).toEqual(["purchases", "sales"]);
    expect(rebuilt.primaryEntity).toBe("order");
    expect(rebuilt.tags).toEqual(["revenue"]);
    const statusFm = rebuilt.columns?.find((c) => c.id === "table:public.orders#status");
    expect(statusFm?.aliases).toEqual(["order_status"]);
    expect(statusFm?.enum).toEqual(["pending", "paid"]);
    expect(statusFm?.description).toBe("Order state.");
  });

  it("buildFrontmatter omits empty optional fields", () => {
    const draft = buildTableDraft(physical as never, undefined);
    draft.description = "anything";
    const fm = buildFrontmatter(physical as never, "orders-users", draft);
    expect(fm.aliases).toBeUndefined();
    expect(fm.primaryEntity).toBeUndefined();
    expect(fm.tags).toBeUndefined();
    expect(fm.sensitive).toBeUndefined();
    // No describable column fields → columns array is omitted.
    expect(fm.columns).toBeUndefined();
  });

  it("findSensitiveColumnReferences detects sensitive column names in text", () => {
    const refs = findSensitiveColumnReferences(
      "We filter on email when we need to deduplicate users.",
      physical as never,
    );
    expect(refs).toEqual(["email"]);
  });

  it("findSensitiveColumnReferences ignores non-sensitive columns", () => {
    const refs = findSensitiveColumnReferences(
      "The status column drives all reporting filters.",
      physical as never,
    );
    expect(refs).toEqual([]);
  });
});
