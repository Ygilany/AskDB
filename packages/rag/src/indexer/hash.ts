import { createHash } from "node:crypto";

/** Content hash used for skip-reembed bookkeeping. SHA-256, hex. */
export function chunkContentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
