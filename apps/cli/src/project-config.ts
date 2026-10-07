import { bootstrapAskDbEnv, discoverAskDbConfigPath } from "@askdb/config";
import { AskDbError } from "@askdb/core";

/** Thrown when a command needs a project config and the working directory has none. */
export class MissingAskDbConfigError extends AskDbError {
  constructor(cwd: string) {
    super(`No askdb.config.* or .config/askdb.* found in ${cwd}. Run \`npx askdb init\` to create one.`);
    this.name = "MissingAskDbConfigError";
  }
}

/**
 * Loads `.env` + the project config and installs the runtime snapshot. Each command calls this
 * only on the path that reads config, so `--help`, `--version`, `init`, and `bundle` work in a
 * directory without one. A config that exists but fails to load throws its load error.
 */
export function requireAskDbConfig(): void {
  const cwd = process.cwd();
  if (!discoverAskDbConfigPath(cwd)) throw new MissingAskDbConfigError(cwd);
  bootstrapAskDbEnv({ cwd });
}
