/**
 * Reading OpenAI's wire format: the reply text in a Responses API or Chat Completions body.
 * Shared by the replay server's record mode and the live suite, which reads the raw reply on
 * the raw-model path. Node built-ins only: this never imports AskDB.
 */

/** The reply text in a Responses API or Chat Completions body, or null when it holds none. */
export function replyText(body: Record<string, unknown>): string | null {
  const output = body.output as { content?: { type?: string; text?: string }[] }[] | undefined;
  const fromResponses = output?.flatMap((item) => item.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text ?? "");
  if (fromResponses?.length) return fromResponses.join("");
  const choices = body.choices as { message?: { content?: unknown } }[] | undefined;
  const content = choices?.[0]?.message?.content;
  return typeof content === "string" ? content : null;
}
