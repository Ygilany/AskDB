import type { ConnectionLabelParts } from "@askdb/introspect/kit";

/**
 * The display-safe part of a SQLite "connection string": the file path. A
 * plain path (or `:memory:`) is returned as-is; `formatConnectionLabel` then
 * rejects one that contains `? # ; = @` or a control character. For a `file:`
 * URI only the path is returned; its query string (where encryption keys live)
 * is never read. Anything else returns `undefined`, so the registry labels it
 * `configured sqlite connection`.
 */
export function parseSqliteConnection(input: string): ConnectionLabelParts | undefined {
  if (!/^file:/i.test(input)) {
    return input.includes("://") ? undefined : { file: input };
  }
  const uri = input.slice("file:".length);
  if (uri.includes("#")) return undefined;
  const query = uri.indexOf("?");
  let path = query === -1 ? uri : uri.slice(0, query);
  if (path.startsWith("//")) {
    // file://[localhost]/path — any other authority is not a local file.
    const slash = path.indexOf("/", 2);
    const authority = slash === -1 ? path.slice(2) : path.slice(2, slash);
    if (authority !== "" && authority.toLowerCase() !== "localhost") return undefined;
    path = slash === -1 ? "" : path.slice(slash);
  }
  return path === "" ? undefined : { file: path };
}
