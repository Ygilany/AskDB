import { readFileSync } from "node:fs";

/** The `askdb` package version, printed by `askdb --version` and `askdb introspect --version`. */
export function readCliVersion(): string {
  const parsed = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version?: unknown;
  };
  return typeof parsed.version === "string" ? parsed.version : "0.0.0";
}
