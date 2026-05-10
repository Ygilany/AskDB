import type { LanguageModel } from "ai";
import { generateText as defaultGenerateText } from "ai";
import {
  ENRICHMENT_SYSTEM_PROMPT,
  buildEnrichmentUserPrompt,
} from "./prompt.js";
import type {
  EnrichmentCandidate,
  EnrichmentContext,
  EnrichmentTarget,
} from "./types.js";

export type SuggestEnrichmentDeps = {
  generateText?: typeof defaultGenerateText;
  /** Optional cap on the number of candidates returned. Default 3. */
  maxCandidates?: number;
  /** Sampling temperature. Default 0.4 — small variety, mostly grounded. */
  temperature?: number;
};

/**
 * Ask the model for 1–3 enrichment candidates for the given target. The model
 * is expected to reply with candidates separated by lines containing only `---`.
 *
 * Falls back to a single candidate if no `---` separators are present.
 */
export async function suggestEnrichment(
  target: EnrichmentTarget,
  context: EnrichmentContext,
  model: LanguageModel,
  deps: SuggestEnrichmentDeps = {},
): Promise<EnrichmentCandidate[]> {
  const generateText = deps.generateText ?? defaultGenerateText;
  const maxCandidates = deps.maxCandidates ?? 3;

  const result = await generateText({
    model,
    system: ENRICHMENT_SYSTEM_PROMPT,
    prompt: buildEnrichmentUserPrompt(target, context),
    temperature: deps.temperature ?? 0.4,
  });
  const text = (result as { text: string }).text;
  return parseCandidates(text, maxCandidates);
}

/**
 * Parse the model's reply into candidates. Splits on lines containing only
 * three or more dashes (`---`, `----`, …). Trims each candidate; drops empties.
 */
export function parseCandidates(raw: string, max: number): EnrichmentCandidate[] {
  const parts = raw.split(/^-{3,}\s*$/m);
  const candidates: EnrichmentCandidate[] = [];
  for (const part of parts) {
    const text = part.trim();
    if (!text) continue;
    candidates.push({ text });
    if (candidates.length >= max) break;
  }
  return candidates;
}
