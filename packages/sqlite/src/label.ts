import { formatConnectionLabel, type ConnectionLabelParts } from "@askdb/connectors";

/**
 * A credential-free label for a SQLite database, for display or logs: the file
 * path. A plain path (or `:memory:`) is shown as-is when it contains none of
 * `? # ; = @` or a control character. For a `file:` URI only the path is
 * shown; its query string (where encryption keys live) is never read. Anything
 * else becomes `configured sqlite connection`.
 */
export function connectionLabel(input: string): string {
  return formatConnectionLabel("sqlite", parseSqliteConnection(input));
}

function parseSqliteConnection(input: string): ConnectionLabelParts | undefined {
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
