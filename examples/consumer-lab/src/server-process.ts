/**
 * An installed AskDB server bin (`askdb-http`, `askdb studio`), run as a child process on
 * 127.0.0.1 on a free port, with the environment scrubbed of provider keys and its output
 * captured. It is ready once `ready` says so; `close()` kills it. Callers call `close()`
 * in `afterAll` or `finally`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";

/** Provider keys a developer's shell may hold; a server must only see the config it's given. */
const PROVIDER_KEYS = ["OPENAI_API_KEY", "AZURE_OPENAI_API_KEY", "AZURE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"];

/** A port nothing is listening on right now (the bins reject `--port 0`). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** How `close()` stopped the process: `forced` when it ignored SIGTERM and needed SIGKILL. */
export interface ServerStop {
  forced: boolean;
}

/** SIGTERM the process, then SIGKILL it if it hasn't exited within 5 seconds. */
function stopProcess(child: ChildProcess): Promise<ServerStop> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return Promise.resolve({ forced: false });
  return new Promise((resolve) => {
    let forced = false;
    const force = setTimeout(() => {
      forced = true;
      child.kill("SIGKILL");
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(force);
      resolve({ forced });
    });
    child.kill("SIGTERM");
  });
}

export interface ServerProcessOptions {
  /** The command, for error messages, e.g. `askdb-http`. */
  name: string;
  bin: string;
  /** The arguments, given the port to listen on. */
  args: (port: number) => string[];
  cwd: string;
  /** Extra environment. */
  env?: Record<string, string>;
  /** Whether the server answers yet. A throw means it isn't listening yet. */
  ready: (port: number) => Promise<boolean>;
  /** What `ready` waits for, for error messages, e.g. `GET /health`. */
  readyWhen: string;
}

export interface ServerProcess {
  readonly port: number;
  /** Everything the process wrote to stdout and stderr so far. */
  output(): string;
  close(): Promise<void>;
  /** `close()`, saying whether the process needed SIGKILL. */
  stop(): Promise<ServerStop>;
}

/** Start the server and wait until it's ready. Fails with its output if it can't start or exits first. */
export async function startServerProcess(options: ServerProcessOptions): Promise<ServerProcess> {
  if (!existsSync(options.bin)) throw new Error(`${options.bin} is missing; reinstall the lab with \`pnpm lab:use <target>\``);
  const port = await freePort();
  const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
  for (const key of PROVIDER_KEYS) delete env[key];
  const child = spawn(options.bin, options.args(port), { cwd: options.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let spawnError: Error | undefined;
  child.on("error", (error) => (spawnError = error));
  child.stdout!.on("data", (d) => (output += d));
  child.stderr!.on("data", (d) => (output += d));

  const server: ServerProcess = {
    port,
    output: () => output,
    close: async () => void (await stopProcess(child)),
    stop: () => stopProcess(child),
  };
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (spawnError) throw new Error(`${options.name} couldn't start: ${spawnError.message}`);
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`${options.name} exited (${child.exitCode ?? child.signalCode}) before answering ${options.readyWhen}:\n${output}`);
    }
    try {
      if (await options.ready(port)) return server;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  await server.close();
  throw new Error(`${options.name} didn't answer ${options.readyWhen} within 30s:\n${output}`);
}
