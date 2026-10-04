/** Opt-in safety proofs. Own the whole lifecycle, including cleanup on failure/signals. */
import { spawn } from "node:child_process";
import { mkdirSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectionUrl } from "./fixture.js";
import { assertIsolatedTarget, assertLocalDocker, COMPOSE_ARGS, docker, FIXTURE_ROOT, ISOLATED_ENV, ISOLATED_PORTS, ISOLATED_PROJECT, type ServerDialect } from "./isolated-fixture.js";
import { LAB_ROOT } from "./paths.js";

Object.assign(process.env, ISOLATED_ENV);
const env = { ...process.env, ASKDB_LAB_ISOLATED: "1" };
const lock = join(tmpdir(), `${ISOLATED_PROJECT}.lock`);
assertLocalDocker();
// A fixed project/port set cannot be used by two worktrees at once. Never reap an
// existing project: it could belong to another run. Stale locks require inspection.
mkdirSync(lock);
let owned = false;
let interrupted = false;
let cleaning = false;
let child: ReturnType<typeof spawn> | undefined;
function stopChild(): void {
  if (!child?.pid) return;
  // pnpm/tsx/Compose start descendants. Kill the whole group before teardown,
  // so an orphan Vitest process cannot keep issuing SQL during cleanup.
  try { process.kill(-child.pid, "SIGTERM"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
const onSignal = () => {
  if (cleaning) return;
  interrupted = true;
  stopChild();
};
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
const started = performance.now();
async function run(command: string, args: string[], cwd = LAB_ROOT): Promise<void> {
  if (interrupted) throw new Error("isolated fixture: interrupted");
  await new Promise<void>((resolve, reject) => {
    child = spawn(command, args, { cwd, env, stdio: "inherit", detached: true });
    const deadline = setTimeout(stopChild, 10 * 60_000);
    child.on("error", (error) => { clearTimeout(deadline); reject(error); });
    child.on("exit", (code, signal) => { clearTimeout(deadline); child = undefined; code === 0 ? resolve() : reject(new Error(`${command} exited ${code ?? signal}`)); });
  });
}
async function timed(label: string, fn: () => Promise<void>): Promise<void> {
  const start = performance.now();
  try { await fn(); } finally { console.log(`isolated timing: ${label} ${((performance.now() - start) / 1000).toFixed(2)}s`); }
}
try {
  if (docker(["ps", "-aq", "--filter", `label=com.docker.compose.project=${ISOLATED_PROJECT}`]) ||
      docker(["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${ISOLATED_PROJECT}`]) ||
      docker(["network", "ls", "-q", "--filter", `label=com.docker.compose.project=${ISOLATED_PROJECT}`])) {
    throw new Error("isolated fixture: project already exists; refusing to take ownership");
  }
  owned = true;
  await timed("startup", () => run("docker", [...COMPOSE_ARGS, "up", "-d", "--wait", "--wait-timeout", "180"]));
  for (const dialect of Object.keys(ISOLATED_PORTS) as ServerDialect[]) assertIsolatedTarget(dialect, connectionUrl(dialect, "owner"));
  await timed("seed", () => run("pnpm", ["exec", "tsx", "src/seed.ts"], FIXTURE_ROOT));
  await timed("guards", () => run("pnpm", ["exec", "vitest", "run", "test/isolated-fixture.test.ts"]));
  await timed("suite", () => run("pnpm", ["exec", "vitest", "run", "test/safety.test.ts", ...process.argv.slice(2)]));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  try {
    // Cleanup still runs after SIGINT/SIGTERM and after partially failed startup.
    if (interrupted) process.exitCode = 1;
    cleaning = true;
    interrupted = false;
    if (owned) await timed("teardown", () => run("docker", [...COMPOSE_ARGS, "down", "-v"]));
  } finally {
    rmdirSync(lock);
    console.log(`isolated timing: total ${((performance.now() - started) / 1000).toFixed(2)}s`);
  }
}
