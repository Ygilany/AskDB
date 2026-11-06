import type { LanguageModel } from "ai";
import { describe, expect, it, vi } from "vitest";
import { SensitiveEnrichmentTargetError } from "../errors.js";
import { buildEnrichmentUserPrompt } from "./prompt.js";
import { parseCandidates, suggestEnrichment } from "./suggest.js";
import type { EnrichmentTarget } from "./types.js";
import type { NormalizedV2Table } from "../schema/v2/normalized.js";

const usersTable: NormalizedV2Table = {
  id: "table:public.users",
  schema: "public",
  name: "users",
  sensitive: false,
  columns: [
    {
      id: "column:public.users.id",
      name: "id",
      type: "uuid",
      nullable: false,
      primaryKey: true,
      sensitive: false,
    },
    {
      id: "column:public.users.email",
      name: "email",
      type: "text",
      nullable: false,
      primaryKey: false,
      sensitive: true,
    },
  ],
};

/**
 * Sensitive through the table flag only, as a table built by hand may be: `loadSchema()` also
 * marks each column of a sensitive table sensitive.
 */
const payrollTable: NormalizedV2Table = {
  id: "table:public.payroll",
  schema: "public",
  name: "payroll",
  sensitive: true,
  columns: [
    {
      id: "table:public.payroll#salary_band",
      name: "salary_band",
      type: "text",
      nullable: false,
      primaryKey: false,
      sensitive: false,
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
    expect(prompt).toContain("TABLE public.users");
    expect(prompt).toContain("- email text (NOT NULL) (sensitive)");
    expect(prompt).toContain("one-sentence description");
  });

  it("leaves sensitive columns out of the prompt when omitSensitiveIdentifiersFromPrompt is on", async () => {
    const generateText = vi.fn(async () => ({ text: "A description." }));

    for (const table of [usersTable, payrollTable]) {
      await suggestEnrichment({ kind: "table-description", table }, { schemaId: "orders-users" }, fakeModel, {
        generateText,
        omitSensitiveIdentifiersFromPrompt: true,
      });
    }

    const [users, payroll] = generateText.mock.calls.map(
      (call) => (call as unknown as [{ prompt: string }])[0].prompt,
    );
    expect(users).not.toContain("email");
    expect(users).toContain("- id uuid (PK NOT NULL)");
    // A sensitive table keeps its name, as in ask()'s prompt, but none of its columns.
    expect(payroll).toContain("TABLE public.payroll");
    expect(payroll).not.toContain("salary_band");
  });

  it("refuses a sensitive column as the target only when omitSensitiveIdentifiersFromPrompt is on", async () => {
    const generateText = vi.fn(async () => ({ text: "A description." }));
    const targets: Array<{ target: EnrichmentTarget; name: string }> = [
      { target: { kind: "column-description", table: usersTable, columnId: "column:public.users.email" }, name: "email" },
      // Sensitive through its table only.
      {
        target: { kind: "column-aliases", table: payrollTable, columnId: "table:public.payroll#salary_band" },
        name: "salary_band",
      },
    ];

    for (const { target, name } of targets) {
      const error = await suggestEnrichment(target, { schemaId: "orders-users" }, fakeModel, {
        generateText,
        omitSensitiveIdentifiersFromPrompt: true,
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SensitiveEnrichmentTargetError);
      // Error messages never name a sensitive identifier.
      expect((error as Error).message).not.toContain(name);
    }
    expect(generateText).not.toHaveBeenCalled();

    // With omission off, the same targets reach the model.
    for (const { target } of targets) {
      await suggestEnrichment(target, { schemaId: "orders-users" }, fakeModel, { generateText });
    }
    expect(generateText).toHaveBeenCalledTimes(2);
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
        prompt: expect.stringContaining("TABLE public.users"),
      }),
    );
  });

  it("sends the system prompt as `system` (honored by AI SDK 6 and 7), not `instructions`", async () => {
    const generateText = vi.fn(async () => ({ text: "A description." }));
    const target: EnrichmentTarget = { kind: "table-description", table: usersTable };

    await suggestEnrichment(target, { schemaId: "orders-users" }, fakeModel, { generateText });

    const call = generateText.mock.calls[0]![0] as Record<string, unknown>;
    expect(typeof call.system).toBe("string");
    expect("instructions" in call).toBe(false);
  });

  it("does not send providerOptions to generateText when unset (preserves current behavior)", async () => {
    const generateText = vi.fn(async () => ({ text: "A description." }));
    const target: EnrichmentTarget = { kind: "table-description", table: usersTable };

    await suggestEnrichment(target, { schemaId: "orders-users" }, fakeModel, { generateText });

    const call = generateText.mock.calls[0]![0] as Record<string, unknown>;
    expect("providerOptions" in call).toBe(false);
  });

  it("forwards deps.providerOptions verbatim to generateText when set", async () => {
    const generateText = vi.fn(async () => ({ text: "A description." }));
    const target: EnrichmentTarget = { kind: "table-description", table: usersTable };
    const providerOptions = { google: { thinkingConfig: { thinkingBudget: 0 } } };

    await suggestEnrichment(target, { schemaId: "orders-users" }, fakeModel, {
      generateText,
      providerOptions,
    });

    const call = generateText.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.providerOptions).toBe(providerOptions);
  });
});
