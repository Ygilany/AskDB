/**
 * A thrown value's message for an error report, with the reason added when the message stops
 * before giving one. A refused connection reaches the model call as the AI SDK's
 * `Cannot connect to API: ` (the cause's empty message) over a message-less `AggregateError`,
 * often inside the retry's `Last error: …`, so the text ends at a colon.
 *
 * The reason comes from the errors under it: an `AggregateError`'s errors, a retry error's
 * `lastError`, else `cause`. Each one that gives no reason itself is read as its `code` with
 * the `address` (or `hostname`) and `port` it names, else its `name`. Unlike the `askdb` CLI's
 * `errorMessage()`, it never copies their message text, which can quote a URL with credentials:
 * shown text is built from allowlisted parts, the rule ADR 0011 sets for connection labels.
 * A message that already gives its reason is returned unchanged. It never throws.
 */
export function failureMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const message = messageOf(error);
  if (!stopsBeforeReason(message)) return message;
  const reasons = [...new Set(reasonsUnder(error, new Set([error]), 0))].join("; ");
  const text = message.trimEnd();
  if (!reasons) return text || ownReason(error);
  return text ? `${text} ${reasons}` : reasons;
}

const MAX_DEPTH = 8;
const CODE = /^[A-Z][A-Z0-9_]*$/;
const NAME = /^[A-Za-z_$][\w$]*$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6 = /^[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*$/;
const HOSTNAME = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

/** `error.message` as a string: a host-built error can set it to anything. */
function messageOf(error: Error): string {
  return typeof error.message === "string" ? error.message : String(error.message);
}

function stopsBeforeReason(message: string): boolean {
  const text = message.trimEnd();
  return text === "" || text.endsWith(":");
}

/** The reasons found below `error`, which gave none of its own. */
function reasonsUnder(error: Error, seen: Set<unknown>, depth: number): string[] {
  const { lastError, cause } = error as { lastError?: unknown; cause?: unknown };
  const errors = error instanceof AggregateError ? (error as { errors?: unknown }).errors : undefined;
  const below = Array.isArray(errors) ? errors : lastError !== undefined ? [lastError] : cause !== undefined ? [cause] : [];
  return below.flatMap((child) => reasonsFor(child, seen, depth + 1));
}

/** One error's reason: what lies below it when it stops before giving one, else its own parts. */
function reasonsFor(error: unknown, seen: Set<unknown>, depth: number): string[] {
  if (!(error instanceof Error) || seen.has(error) || depth > MAX_DEPTH) return [];
  seen.add(error);
  if (stopsBeforeReason(messageOf(error))) {
    const below = reasonsUnder(error, seen, depth);
    if (below.length > 0) return below;
  }
  return [ownReason(error)];
}

/** `ECONNREFUSED 127.0.0.1:11434`, `ECONNREFUSED`, or the error's name: never its message. */
function ownReason(error: Error): string {
  const { code, address, hostname, port, name } = error as {
    code?: unknown;
    address?: unknown;
    hostname?: unknown;
    port?: unknown;
    name?: unknown;
  };
  if (typeof code !== "string" || !CODE.test(code)) return typeof name === "string" && NAME.test(name) ? name : "Error";
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
