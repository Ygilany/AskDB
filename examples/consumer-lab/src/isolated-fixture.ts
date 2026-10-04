/** #323: the lab's disposable second fixture, never the shared askdb-fixture project. */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import mssql from "mssql";
import type { SupportedDialect } from "./dialects.js";

export type ServerDialect = Exclude<SupportedDialect, "sqlite">;
export const ISOLATED_PROJECT = "askdb-lab-isolated";
export const ISOLATED_PORTS = { postgres: 25432, mysql: 23306, mariadb: 23307, sqlserver: 21433 } as const;
const INTERNAL_PORTS = { postgres: 5432, mysql: 3306, mariadb: 3307, sqlserver: 1433 } as const;
export const FIXTURE_ROOT = fileURLToPath(new URL("../../../fixtures/multi-engine/", import.meta.url));
export const COMPOSE_ARGS = ["compose", "-f", `${FIXTURE_ROOT}compose.yml`, "-f", fileURLToPath(new URL("../compose.isolated.yml", import.meta.url)), "-p", ISOLATED_PROJECT];
export const ISOLATED_ENV = {
  ASKDB_LAB_RELAY_CONFIG: fileURLToPath(new URL("../isolated-haproxy.cfg", import.meta.url)),
  ASKDB_FIXTURE_HOST: "127.0.0.1",
  COMPOSE_PROJECT_NAME: ISOLATED_PROJECT,
  ...Object.fromEntries(Object.entries(ISOLATED_PORTS).map(([d, p]) => [`ASKDB_FIXTURE_${d.toUpperCase()}_PORT`, String(p)])),
};

export function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", timeout: 30_000 }).trim();
}

/** Local endpoint checks are meaningful only against a local Docker daemon. */
export function assertLocalDocker(): void {
  const endpoint = process.env.DOCKER_CONTEXT ? JSON.parse(docker(["context", "inspect", process.env.DOCKER_CONTEXT]))[0]?.Endpoints?.docker?.Host :
    process.env.DOCKER_HOST || JSON.parse(docker(["context", "inspect"]))[0]?.Endpoints?.docker?.Host;
  if (typeof endpoint !== "string" || !endpoint.startsWith("unix://")) throw new Error("isolated fixture: requires a local Unix-socket Docker daemon");
}

/**
 * Verify the URL the driver will actually use, then resolve its published port to a live
 * container on the local daemon. An environment flag alone never authorizes execution.
 * Return the inspected container ID so file observations address that very container.
 */
export function assertIsolatedTarget(dialect: ServerDialect, connectionString: string): string {
  const endpoint = dialect === "sqlserver" ? mssql.ConnectionPool.parseConnectionString(connectionString) : new URL(connectionString);
  const host = "server" in endpoint ? endpoint.server : endpoint.hostname;
  const port = Number(endpoint.port);
  if (host !== "127.0.0.1" || port !== ISOLATED_PORTS[dialect]) {
    throw new Error(`isolated fixture: refused endpoint ${host}:${port} for ${dialect}`);
  }
  assertLocalDocker();
  const ids = docker(["ps", "-q"]).split(/\s+/).filter(Boolean);
  const containers = ids.length ? JSON.parse(docker(["inspect", ...ids])) : [];
  const matching = containers.filter((c: { NetworkSettings: { Ports: Record<string, { HostPort: string }[] | null> } }) =>
    Object.values(c.NetworkSettings.Ports).some((bindings) => bindings?.some((binding) => binding.HostPort === String(port))));
  if (matching.length !== 1) throw new Error(`isolated fixture: expected one container publishing ${port}`);
  const [relay] = matching;
  const relayLabels = relay.Config.Labels;
  if (relayLabels["com.docker.compose.project"] !== ISOLATED_PROJECT || relayLabels["com.docker.compose.service"] !== "relay" ||
      relay.Name !== `/${ISOLATED_PROJECT}-relay-1` || relay.HostConfig.Sysctls?.["net.ipv4.ip_forward"] !== "0" ||
      docker(["exec", relay.Id, "cat", "/usr/local/etc/haproxy/haproxy.cfg"]) !== readFileSync(ISOLATED_ENV.ASKDB_LAB_RELAY_CONFIG, "utf8").trim()) {
    throw new Error(`isolated fixture: relay identity/config mismatch for ${dialect}`);
  }
  const [container] = JSON.parse(docker(["inspect", `${ISOLATED_PROJECT}-${dialect}-1`]));
  const labels = container.Config.Labels;
  const bindings = relay.NetworkSettings.Ports[`${INTERNAL_PORTS[dialect]}/tcp`];
  if (labels["com.docker.compose.project"] !== ISOLATED_PROJECT || labels["com.docker.compose.service"] !== dialect ||
      container.Name !== `/${ISOLATED_PROJECT}-${dialect}-1` || container.State.Health?.Status !== "healthy" ||
      bindings?.length !== 1 || bindings[0].HostIp !== "127.0.0.1" || bindings[0].HostPort !== String(port)) {
    throw new Error(`isolated fixture: container identity/binding mismatch for ${dialect}`);
  }
  // No host networking, additional network, host bind mounts, or shared fixture volume.
  const networks = Object.values(container.NetworkSettings.Networks) as { NetworkID: string }[];
  const network = networks.length === 1 ? JSON.parse(docker(["network", "inspect", networks[0]!.NetworkID]))[0] : undefined;
  if (!network?.Internal || network.Options?.["com.docker.network.bridge.gateway_mode_ipv4"] !== "isolated" ||
      !Object.values(relay.NetworkSettings.Networks).some((n) => (n as { NetworkID: string }).NetworkID === network.Id) || network.Labels?.["com.docker.compose.project"] !== ISOLATED_PROJECT ||
      container.HostConfig.Privileged || container.HostConfig.NetworkMode === "host" ||
      container.Mounts.some((m: { Type: string; Name?: string }) => m.Type !== "volume" || !m.Name?.startsWith(`${ISOLATED_PROJECT}_`))) {
    throw new Error(`isolated fixture: network/mount isolation mismatch for ${dialect}`);
  }
  const volumes = container.Mounts.map((m: { Name: string }) => m.Name);
  if (!volumes.length || JSON.parse(docker(["volume", "inspect", ...volumes])).some((v: { Labels?: Record<string, string> }) =>
    v.Labels?.["com.docker.compose.project"] !== ISOLATED_PROJECT)) {
    throw new Error(`isolated fixture: volume ownership mismatch for ${dialect}`);
  }
  return container.Id;
}
