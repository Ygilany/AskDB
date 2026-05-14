#!/usr/bin/env node
import { bootstrapAskDbEnv } from "@askdb/config";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAskDbHttpServer } from "./server.js";

{
  const here = dirname(fileURLToPath(import.meta.url));
  // When compiled, `here` is `.../apps/http-api/dist`, so repo root is 3 levels up.
  const repoRootEnv = resolve(here, "../../../.env");
  const cwdEnv = resolve(process.cwd(), ".env");
  const pkgEnv = resolve(here, "../.env");

  // Prefer repo root `.env`, but be resilient to different working directories.
  const candidates = [repoRootEnv, cwdEnv, pkgEnv].filter((p) => existsSync(p));
  bootstrapAskDbEnv({
    cwd: process.cwd(),
    dotenvCandidatePaths: candidates.length > 0 ? candidates : undefined,
  });
}

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const host = process.env.HOST ?? "127.0.0.1";

const app = createAskDbHttpServer({ port, host });
await app.listen();
console.log(`AskDB HTTP API listening on http://${app.host}:${app.port}`);
