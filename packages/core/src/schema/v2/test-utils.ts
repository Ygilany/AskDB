import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Fixtures shared by the `saveSchemaFile` test files. `tsconfig.build.json` leaves
// this file out of `dist`; `pnpm lint` type-checks it with the tests.

/**
 * A group, other than the one new files in a temp directory get, that this
 * process belongs to and so may give a file.
 */
export const otherGroup = (() => {
  if (process.platform === "win32") return undefined;
  const dir = mkdtempSync(join(tmpdir(), "askdb-core-gid-"));
  const newFileGid = statSync(dir).gid;
  rmSync(dir, { recursive: true });
  return process.getgroups?.().find((g) => g !== newFileGid && g !== process.getegid?.());
})();

/** Why a test that gives a file `otherGroup` can't run here, or `false`. */
export const otherGroupUnavailable =
  process.platform === "win32"
    ? "POSIX owners and groups are required (not Windows)"
    : otherGroup === undefined
      ? "this user belongs to no second group to give the file"
      : false;
