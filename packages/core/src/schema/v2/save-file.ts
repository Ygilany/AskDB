import { randomBytes } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fchownSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";

/**
 * Write `content` (a string, written as UTF-8, or bytes written as given) to a file
 * inside a schema directory so that no link can redirect the write out of it
 * (ADR 0028). `relativePath` names the file from `schemaDir`
 * with `/` between its parts (`schema.json`, `tables/orders.md`). Every AskDB writer
 * into a schema directory goes through here: `@askdb/enrich`'s saves, Studio's
 * Playground history and `.gitignore`, and `@askdb/introspect`'s `schema.json`. A
 * schema directory can come from an untrusted checkout (git stores symbolic links,
 * tar archives also store hard links), and Studio saves into it for as long as it
 * runs.
 *
 * Errors read `Refusing to write <relativePath> outside the schema directory: <why>`.
 *
 * - `relativePath` must name a file below `schemaDir`: an empty part, `.`, `..`, a
 *   NUL byte, or (on Windows) `\` in a part is refused, and so is an absolute path.
 * - No directory between the schema directory and the target (`tables/`), and not
 *   the target itself, may be a symbolic link; either one is refused. The schema
 *   directory itself may be one: it is the path the user chose. Directories are not
 *   created.
 * - The content goes to a new temp file next to the target (`O_EXCL`, so it never
 *   opens an existing path), which is then renamed over the target. `rename`
 *   replaces the directory entry instead of writing into the existing file, so a
 *   hard link to a file elsewhere is detached, not written through, and a symbolic
 *   link planted at the target after the check is replaced, not followed. This
 *   holds on Windows too, which has no `O_NOFOLLOW`.
 * - A target the caller can't write is refused with `EACCES`, as a plain write
 *   would be. `rename` needs only write access to the directory, so without this
 *   check a read-only file (how Perforce and ClearCase mark files not checked out)
 *   would be replaced on macOS and Linux. The temp file needs write access to the
 *   directory too, so a save into a directory the caller can't write fails with
 *   `EACCES` even when the file itself is writable.
 * - The temp file gets the target's owner, group, and permission bits before any
 *   content is written, so a `0600` file's new content is never readable by others
 *   and a `0660` file stays shared with its own group, not the group a new file in
 *   the directory would get (`keepOwnerAndGroup`). It is `fsync`ed before the
 *   rename. Readers, and a crash or power loss, see either the old file or the new
 *   one, never a partial write.
 *
 * Not covered: a directory between the schema directory and the target (`tables/`)
 * being swapped for a link after the check and before the rename, since the temp
 * path and the rename still resolve through it. That needs a concurrent local
 * writer racing a save. And only root can give a file to another user, so on macOS
 * and Linux a save by someone other than the file's owner (a member of a group that
 * may write it) makes the saver its owner. On Windows, the rename fails with `EPERM`
 * while another process holds the target open without delete sharing.
 */
export function saveSchemaFile(
  schemaDir: string,
  relativePath: string,
  content: string | Uint8Array,
): void {
  const refuse = (why: string) =>
    new Error(`Refusing to write ${relativePath} outside the schema directory: ${why}`);
  const dirs = relativePath.split("/");
  for (const part of dirs) {
    if (
      part === "" ||
      part === "." ||
      part === ".." ||
      part.includes("\0") ||
      (process.platform === "win32" && part.includes("\\"))
    ) {
      throw refuse(`${JSON.stringify(part)} is not a file or directory name`);
    }
  }
  const filename = dirs.pop()!;
  let dir = schemaDir;
  for (const [i, part] of dirs.entries()) {
    dir = join(dir, part);
    if (lstatSync(dir).isSymbolicLink()) {
      throw refuse(`${dirs.slice(0, i + 1).join("/")}/ is a symbolic link`);
    }
  }
  const filePath = join(dir, filename);
  const existing = lstatSync(filePath, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink()) throw refuse(`${JSON.stringify(filename)} is a symbolic link`);
  if (existing) accessSync(filePath, fsConstants.W_OK);

  const tempPath = join(dir, `.askdb-save-${randomBytes(8).toString("hex")}.tmp`);
  const fd = openSync(
    tempPath,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
    0o666,
  );
  try {
    try {
      // Keep the replaced file's owner, group, and permission bits, before the content lands.
      if (existing) {
        const mode = existing.mode & 0o777;
        const groupKept = keepOwnerAndGroup(fd, existing);
        fchmodSync(fd, groupKept ? mode : modeWhenGroupLost(mode));
      }
      writeFileSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tempPath, filePath);
  } catch (e) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Report the save's own error, not a failed cleanup (e.g. Windows EPERM).
    }
    throw e;
  }
}

/**
 * Give the file open at `fd` the owner and group of `existing`, as far as the
 * process may: only root can change a file's owner, and anyone else can set only
 * a group they belong to. Returns whether the group now matches; Windows has no
 * POSIX owner or group, so there it is always true.
 */
function keepOwnerAndGroup(fd: number, existing: Stats): boolean {
  if (process.platform === "win32") return true;
  const tryChown = (uid: number, gid: number) => {
    try {
      fchownSync(fd, uid, gid);
    } catch {
      // Not permitted (or not supported by this file system); checked below.
    }
  };
  if (fstatSync(fd).uid !== existing.uid) tryChown(existing.uid, existing.gid);
  if (fstatSync(fd).gid !== existing.gid) tryChown(-1, existing.gid);
  return fstatSync(fd).gid === existing.gid;
}

/**
 * `mode` for a file whose group could not be kept: the group and others both get
 * only what both had before, so neither the group the file lands in nor the old
 * group's non-members gain access (`0660` becomes `0600`, `0604` becomes `0600`).
 *
 * @internal Exported for its tests; `index.ts` doesn't re-export it.
 */
export function modeWhenGroupLost(mode: number): number {
  const shared = (mode >> 3) & mode & 0o007;
  return (mode & 0o700) | (shared << 3) | shared;
}
