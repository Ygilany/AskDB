import matter from "gray-matter";
import { SchemaParseError } from "../../errors.js";
import {
  RECOGNIZED_H2_SECTIONS,
  v2ConceptsFrontmatterSchema,
  v2TableFrontmatterSchema,
  type ParsedConceptsMarkdown,
  type ParsedTableMarkdown,
  type RecognizedH2Section,
} from "./describable.js";

/**
 * Split YAML front-matter from a markdown body. gray-matter throws a raw
 * `YAMLException` on malformed YAML; rethrow it as a `SchemaParseError` naming
 * the file so callers can rely on one error type for every artifact problem.
 */
export function readFrontMatter(
  content: string,
  kind: string,
  filePath?: string,
): { data: Record<string, unknown>; content: string } {
  try {
    const file = matter(content);
    return { data: file.data, content: file.content };
  } catch (e) {
    const loc = filePath ? ` in ${filePath}` : "";
    const reason = e instanceof Error ? e.message : String(e);
    throw new SchemaParseError(`Malformed ${kind} front-matter YAML${loc}: ${reason}`, e);
  }
}

/**
 * Parse a `tables/<table>.md` file.
 * Front-matter is validated by zod (strict — unknown keys are errors).
 * Recognized H2 sections are extracted; the rest of the body is preserved verbatim.
 */
export function parseTableMarkdown(content: string, filePath?: string): ParsedTableMarkdown {
  const file = readFrontMatter(content, "table", filePath);
  const result = v2TableFrontmatterSchema.safeParse(file.data);
  if (!result.success) {
    const loc = filePath ? ` in ${filePath}` : "";
    throw new SchemaParseError(
      `Invalid table front-matter${loc}: ${result.error.message}`,
      result.error,
    );
  }

  const body = file.content;
  const sections = extractH2Sections(body);

  return { frontmatter: result.data, body, sections };
}

/**
 * Parse `concepts.md`.
 */
export function parseConceptsMarkdown(content: string, filePath?: string): ParsedConceptsMarkdown {
  const file = readFrontMatter(content, "concepts", filePath);
  const result = v2ConceptsFrontmatterSchema.safeParse(file.data);
  if (!result.success) {
    const loc = filePath ? ` in ${filePath}` : "";
    throw new SchemaParseError(
      `Invalid concepts front-matter${loc}: ${result.error.message}`,
      result.error,
    );
  }
  return { frontmatter: result.data, body: file.content };
}

/** Extract recognized H2 sections from a markdown body string. */
function extractH2Sections(body: string): Partial<Record<RecognizedH2Section, string>> {
  const sections: Partial<Record<RecognizedH2Section, string>> = {};
  // Split on H2 headings
  const parts = body.split(/^## /m);
  for (const part of parts.slice(1)) {
    const newline = part.indexOf("\n");
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim();
    const sectionBody = newline === -1 ? "" : part.slice(newline + 1);
    const matched = RECOGNIZED_H2_SECTIONS.find(
      (s) => s.toLowerCase() === heading.toLowerCase(),
    );
    if (matched) {
      sections[matched] = sectionBody;
    }
  }
  return sections;
}
