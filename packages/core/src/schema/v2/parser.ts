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
 * gray-matter's options for every schema markdown file. Schema files can come from an
 * untrusted bundle or directory, and gray-matter picks a front-matter engine from the text
 * after the opening `---`: `---js` (any case, or `javascript`) runs the block through `eval`,
 * `---json` reads JSON, and `---coffee` names an engine it doesn't ship. Every engine but
 * YAML refuses here. Passing an options object also keeps gray-matter from caching the
 * input: its cache holds every input for the life of the process, and an input that failed
 * to parse stays there as an empty entry, so a second parse would skip the YAML error (#742).
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
    const file = matter(content, FRONT_MATTER_OPTIONS);
    // Any other tag after `---` (a name gray-matter looks up on its engine table, such as
    // `constructor`) isn't YAML either. gray-matter sets `language` to `yaml` when there is none.
    const language = (file.language ?? "yaml").toLowerCase();
    if (language !== "yaml" && language !== "yml") refuseNonYaml();
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
