/**
 * `pnpm lab ui` as a child process, and `POST /api/run` read back as its NDJSON events.
 * Requests go through `node:http` (`studioRequest`), so a test can send any `Host`,
 * `Origin` or `Content-Type`.
 */
import { join } from "node:path";
import type { EngineEvent, UiInput } from "../../src/ui/server.js";
import type { Summary } from "../../src/ui/summary.js";
import { LAB_ROOT } from "../../src/paths.js";
import { startServerProcess, type ServerProcess, type ServerStop } from "../../src/server-process.js";
import { studioRequest, type StudioAddress } from "../../src/studio.js";

export interface LabUiProcess extends StudioAddress {
  close(): Promise<void>;
  /** `close()`, saying whether the process ignored SIGTERM and needed SIGKILL. */
  stop(): Promise<ServerStop>;
}

/** Start `pnpm lab ui --port <free port>` with `args` and `env` added; ready once `GET /` answers 200. */
export async function startLabUiProcess({ args = [], env = {} }: { args?: string[]; env?: Record<string, string> } = {}): Promise<LabUiProcess> {
  const address = (port: number): StudioAddress => ({ port, host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` });
  const server: ServerProcess = await startServerProcess({
    name: "lab ui",
    bin: join(LAB_ROOT, "node_modules", ".bin", "tsx"),
    args: (port) => ["src/lab-cli.ts", "ui", "--port", String(port), ...args],
    cwd: LAB_ROOT,
    env,
    ready: async (port) => (await studioRequest(address(port))).status === 200,
    readyWhen: "GET /",
  });
  return { ...address(server.port), close: () => server.close(), stop: () => server.stop() };
}

export interface UiRun {
  status: number;
  /** Engine events, in the order the server sent them. */
  engines: EngineEvent[];
  summary?: Summary;
}

/** `POST /api/run` as the page sends it. */
export async function uiRun(ui: StudioAddress, input: UiInput): Promise<UiRun> {
  const reply = await studioRequest(ui, {
    method: "POST",
    path: "/api/run",
    headers: { "content-type": "application/json", origin: ui.origin },
    body: JSON.stringify(input),
  });
  if (reply.status !== 200) return { status: reply.status, engines: [] };
  const events = reply.text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return {
    status: reply.status,
    engines: events.filter((e) => e.type === "engine"),
    summary: events.find((e) => e.type === "summary")?.summary,
  };
}

/** One engine's event; fails when the run has none for it. */
export function column(run: UiRun, dialect: string): EngineEvent {
  const event = run.engines.find((e) => e.dialect === dialect);
  if (!event) throw new Error(`no column for ${dialect} in ${JSON.stringify(run).slice(0, 500)}`);
  return event;
}
