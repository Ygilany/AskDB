import matter from "gray-matter";
import type { z } from "zod";
import { SchemaParseError } from "../../errors.js";
import {
  RECOGNIZED_H2_SECTIONS,
  v2ConceptsFrontmatterSchema,
  v2TableFrontmatterSchema,
  type ParsedConceptsMarkdown,
  type ParsedTableMarkdown,
} from "./describable.js";

function refuseNonYaml(): never {
  throw new Error("front-matter must be YAML");
}

/**
 * The front-matter format tag gray-matter reads from `content`: the rest of the first line
 * after an opening `---`, trimmed, read as gray-matter reads it (after a byte-order mark, and
 * not when a fourth `-` follows). Empty when there is no tag or no front-matter.
 */
function frontMatterTag(content: string): string {
  const text = content.startsWith("\uFEFF") ? content.slice(1) : content;
  if (!text.startsWith("---") || text.charAt(3) === "-") return "";
  const rest = text.slice(3);
  return rest.slice(0, rest.search(/\r?\n/)).trim();
}

function isYamlTag(tag: string): boolean {
  const name = tag.toLowerCase();
  return name === "" || name === "yaml" || name === "yml";
}

/**
 * gray-matter's options for every schema markdown file. Schema front-matter is YAML only:
 * `readFrontMatter` checks the format tag before gray-matter reads the block, and the other
 * formats gray-matter ships refuse here too, in case it ever reads a tag differently. Passing
 * an options object also keeps gray-matter from caching the input: its cache holds every input
 * for the life of the process, and an input that failed to parse stays there as an empty
 * entry, so a second parse would skip the YAML error (#742).
 */
const FRONT_MATTER_OPTIONS = {
  engines: { javascript: refuseNonYaml, json: refuseNonYaml, coffee: refuseNonYaml },
};

/**
 * Split YAML front-matter from a markdown body. gray-matter throws a raw
 * `YAMLException` on malformed YAML; rethrow it as a `SchemaParseError` naming
 * the file so callers can rely on one error type for every artifact problem.
 */
function readFrontMatter(
  content: string,
  kind: string,
  filePath?: string,
): { data: Record<string, unknown>; content: string } {
  try {
    // gray-matter takes an object as an already-parsed file and keeps its `data`, so a
    // bundle entry that isn't text never reaches the YAML parser.
    if (typeof content !== "string") throw new Error("expected the file's text");
    if (!isYamlTag(frontMatterTag(content))) refuseNonYaml();
    const file = matter(content, FRONT_MATTER_OPTIONS);
    // The tag gray-matter actually read; it sets `language` to `yaml` when there is none.
    if (!isYamlTag(file.language ?? "yaml")) refuseNonYaml();
    return { data: file.data, content: file.content };
  } catch (e) {
    const loc = filePath ? ` in ${filePath}` : "";
    const reason = e instanceof Error ? e.message : String(e);
    throw new SchemaParseError(`Malformed ${kind} front-matter YAML${loc}: ${reason}`, e);
  }
}

/**
 * Read a markdown file's front-matter and validate it with `schema`. Invalid
 * fields, like malformed YAML, throw a `SchemaParseError` naming the file.
 */
export function parseFrontMatter<S extends z.ZodType>(
  content: string,
  kind: string,
  schema: S,
  filePath?: string,
): { frontmatter: z.output<S>; body: string } {
  const file = readFrontMatter(content, kind, filePath);
  const result = schema.safeParse(file.data);
  if (!result.success) {
    const loc = filePath ? ` in ${filePath}` : "";
    throw new SchemaParseError(
      `Invalid ${kind} front-matter${loc}: ${result.error.message}`,
      result.error,
    );
  }
  return { frontmatter: result.data, body: file.content };
}

/**
 * Parse a `tables/<table>.md` file.
 * Front-matter is validated by zod (strict — unknown keys are errors).
 * Recognized H2 sections are extracted; the rest of the body is preserved verbatim.
 */
export function parseTableMarkdown(content: string, filePath?: string): ParsedTableMarkdown {
  const { frontmatter, body } = parseFrontMatter(content, "table", v2TableFrontmatterSchema, filePath);
  return { frontmatter, body, sections: extractH2Sections(body, RECOGNIZED_H2_SECTIONS) };
}

/**
 * Parse `concepts.md`.
 */
export function parseConceptsMarkdown(content: string, filePath?: string): ParsedConceptsMarkdown {
  return parseFrontMatter(content, "concepts", v2ConceptsFrontmatterSchema, filePath);
}

/** Extract the sections whose H2 heading matches one of `recognized`, ignoring case. */
export function extractH2Sections<S extends string>(
  body: string,
  recognized: readonly S[],
): Partial<Record<S, string>> {
  const sections: Partial<Record<S, string>> = {};
  for (const part of body.split(/^## /m).slice(1)) {
    const newline = part.indexOf("\n");
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim();
    const sectionBody = newline === -1 ? "" : part.slice(newline + 1);
    const matched = recognized.find((s) => s.toLowerCase() === heading.toLowerCase());
    if (matched) {
      sections[matched] = sectionBody;
    }
  }
  return sections;
}
