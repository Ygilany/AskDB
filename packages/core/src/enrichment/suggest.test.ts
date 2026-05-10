import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";
import { buildEnrichmentUserPrompt } from "./prompt.js";
import { parseCandidates, suggestEnrichment } from "./suggest.js";
import type { EnrichmentTarget } from "./types.js";
import type { V2Table } from "../schema/v2/physical.js";

const usersTable: V2Table = {
  id: "table:public.users",
  schema: "public",
  name: "users",
  columns: [
    {
      id: "column:public.users.id",
      name: "id",
      type: "uuid",
      nullable: false,
      primaryKey: true,
    },
    {
      id: "column:public.users.email",
      name: "email",
      type: "text",
      nullable: false,
      sensitive: true,
    },
  ],
};

const fakeModel = {} as LanguageModel;

describe("enrichment suggestions", () => {
  it("parses candidates split by markdown separators and caps the result", () => {
    expect(parseCandidates("one\n---\ntwo\n----\nthree", 2)).toEqual([
      { text: "one" },
      { text: "two" },
    ]);
  });

  it("builds a grounded prompt for a table-level suggestion", () => {
    const prompt = buildEnrichmentUserPrompt(
      { kind: "table-description", table: usersTable },
      { schemaId: "orders-users" },
    );

    expect(prompt).toContain("Schema: orders-users");
    expect(prompt).toContain("Table: public.users");
    expect(prompt).toContain("email text [sensitive]");
    expect(prompt).toContain("one-sentence description");
  });

  it("calls the supplied generator and returns parsed candidates", async () => {
    const generateText = vi.fn(async () => ({
      text: "Registered user accounts.\n---\nPeople who can place orders.",
    }));
    const target: EnrichmentTarget = { kind: "table-description", table: usersTable };

    await expect(
      suggestEnrichment(target, { schemaId: "orders-users" }, fakeModel, {
        generateText,
        temperature: 0.2,
      }),
    ).resolves.toEqual([
      { text: "Registered user accounts." },
      { text: "People who can place orders." },
    ]);

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: fakeModel,
        temperature: 0.2,
        prompt: expect.stringContaining("Table: public.users"),
      }),
    );
  });
});
