import { z } from "zod";

export const v2ColumnFrontmatterSchema = z
  .object({
    id: z.string().min(1),
    aliases: z.array(z.string()).optional(),
    enum: z.array(z.string()).optional(),
    description: z.string().optional(),
    sensitive: z.boolean().optional(),
  })
  .strict();

export const v2TableFrontmatterSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    schemaId: z.string().min(1),
    primaryEntity: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    sensitive: z.boolean().optional(),
    columns: z.array(v2ColumnFrontmatterSchema).optional(),
  })
  .strict();

export type V2TableFrontmatter = z.infer<typeof v2TableFrontmatterSchema>;
export type V2ColumnFrontmatter = z.infer<typeof v2ColumnFrontmatterSchema>;

export const v2ConceptSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    synonyms: z.array(z.string()).optional(),
    links: z.array(z.string()).optional(),
    description: z.string().optional(),
  })
  .strict();

export const v2ConceptsFrontmatterSchema = z
  .object({
    concepts: z.array(v2ConceptSchema),
  })
  .strict();

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
