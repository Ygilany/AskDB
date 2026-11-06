/**
 * A thrown value's message for an error report, with the reason added when the message stops
 * before giving one. A refused connection reaches the model call as the AI SDK's
 * `Cannot connect to API: ` (the cause's empty message) over a message-less `AggregateError`,
 * often inside the retry's `Last error: …`, so the text ends at a colon.
 *
 * The reason comes from the errors under it: an `AggregateError`'s errors, a retry error's
 * `lastError`, else `cause`. Each one that gives no reason itself is read as its `code` with
 * the `address` (or `hostname`) and `port` it names, else its `name`. Their message text is
 * never copied, because it can quote a URL with credentials (ADR 0011: shown text is built from
 * parsed parts). A message that already gives its reason is returned unchanged.
 */
export function failureMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  if (!stopsBeforeReason(error.message)) return error.message;
  const reasons = [...new Set(innerReasons(error, new Set([error]), 0))].join("; ");
  const message = error.message.trimEnd();
  if (!reasons) return message || ownReason(error);
  return message ? `${message} ${reasons}` : reasons;
}

const MAX_DEPTH = 8;
const CODE = /^[A-Z][A-Z0-9_]*$/;
const NAME = /^[A-Za-z_$][\w$]*$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6 = /^[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*$/;
const HOSTNAME = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

function stopsBeforeReason(message: string): boolean {
  const text = message.trimEnd();
  return text === "" || text.endsWith(":");
}

function innerReasons(error: Error, seen: Set<unknown>, depth: number): string[] {
  const lastError = (error as { lastError?: unknown }).lastError;
  const inner =
    error instanceof AggregateError ? error.errors : lastError !== undefined ? [lastError] : error.cause !== undefined ? [error.cause] : [];
  return inner.flatMap((child) => reasonsOf(child, seen, depth + 1));
}

function reasonsOf(error: unknown, seen: Set<unknown>, depth: number): string[] {
  if (!(error instanceof Error) || seen.has(error) || depth > MAX_DEPTH) return [];
  seen.add(error);
  if (stopsBeforeReason(error.message)) {
    const inner = innerReasons(error, seen, depth);
    if (inner.length > 0) return inner;
  }
  return [ownReason(error)];
}

/** `ECONNREFUSED 127.0.0.1:11434`, `ECONNREFUSED`, or the error's name: never its message. */
function ownReason(error: Error): string {
  const { code, address, hostname, port } = error as { code?: unknown; address?: unknown; hostname?: unknown; port?: unknown };
  if (typeof code !== "string" || !CODE.test(code)) return NAME.test(error.name) ? error.name : "Error";
  const host = hostOf(address) ?? hostOf(hostname);
  if (!host) return code;
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port < 65536 ? `${code} ${host}:${port}` : `${code} ${host}`;
}

function hostOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (IPV4.test(value) || HOSTNAME.test(value)) return value;
  if (IPV6.test(value)) return `[${value}]`;
  return undefined;
}
