import { z } from "zod";

export const v2ColumnFrontmatterSchema = z.strictObject({
  id: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  enum: z.array(z.string()).optional(),
  description: z.string().optional(),
  sensitive: z.boolean().optional(),
});

const v2TableFrontmatterInputSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  schemaId: z.string().min(1),
  primaryEntity: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  sensitive: z.boolean().optional(),
  /** When false, this table is excluded from LLM prompts and RAG indexing. Defaults to tracked (true). */
  tracked: z.boolean().optional(),
  /** Authoring alias for `tracked: false`; normalized away after parsing. */
  toIgnore: z.boolean().optional(),
  /** YAML-friendly authoring alias for `tracked: false`; normalized away after parsing. */
  "to-ignore": z.boolean().optional(),
  columns: z.array(v2ColumnFrontmatterSchema).optional(),
});

export const v2TableFrontmatterSchema = v2TableFrontmatterInputSchema
  .superRefine((fm, ctx) => {
    const toIgnore = fm["to-ignore"] ?? fm.toIgnore;
    if (fm.tracked !== undefined && toIgnore !== undefined && fm.tracked === toIgnore) {
      ctx.addIssue({
        code: "custom",
        message: "`tracked` conflicts with `toIgnore`/`to-ignore`",
        path: fm["to-ignore"] !== undefined ? ["to-ignore"] : ["toIgnore"],
      });
    }
  })
  .transform(({ toIgnore, "to-ignore": toIgnoreKebab, ...fm }) => {
    const shouldIgnore = toIgnoreKebab ?? toIgnore;
    if (fm.tracked === undefined && shouldIgnore !== undefined) {
      return { ...fm, tracked: !shouldIgnore };
    }
    return fm;
  });

export type V2TableFrontmatter = z.infer<typeof v2TableFrontmatterSchema>;
export type V2ColumnFrontmatter = z.infer<typeof v2ColumnFrontmatterSchema>;

export const v2ConceptSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  synonyms: z.array(z.string()).optional(),
  links: z.array(z.string()).optional(),
  description: z.string().optional(),
});

export const v2ConceptsFrontmatterSchema = z.strictObject({
  concepts: z.array(v2ConceptSchema),
});

export type V2Concept = z.infer<typeof v2ConceptSchema>;
export type V2ConceptsFrontmatter = z.infer<typeof v2ConceptsFrontmatterSchema>;

/** Recognized H2 section headings in table markdown files. */
export const RECOGNIZED_H2_SECTIONS = [
  "Common query language",
  "Example questions",
  "Business context",
  "Column notes",
] as const;

export type RecognizedH2Section = (typeof RECOGNIZED_H2_SECTIONS)[number];

/** Parsed representation of a `tables/<table>.md` file. */
export type ParsedTableMarkdown = {
  frontmatter: V2TableFrontmatter;
  /** Verbatim markdown body (everything after the closing `---`). */
  body: string;
  /** Recognized H2 section bodies, keyed by heading (case-normalized). */
  sections: Partial<Record<RecognizedH2Section, string>>;
};

/** Parsed representation of `concepts.md`. */
export type ParsedConceptsMarkdown = {
  frontmatter: V2ConceptsFrontmatter;
  body: string;
};
