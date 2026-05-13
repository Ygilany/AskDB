#!/usr/bin/env node
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAskDbHttpServer } from "./server.js";

// Load repo/local `.env` into process.env (if present).
// We treat missing `.env` as normal (developers may export env vars another way).
{
  const here = dirname(fileURLToPath(import.meta.url));
  // When compiled, `here` is `.../apps/http-api/dist`, so repo root is 3 levels up.
  const repoRootEnv = resolve(here, "../../../.env");
  const cwdEnv = resolve(process.cwd(), ".env");
  const pkgEnv = resolve(here, "../.env");

  // Prefer repo root `.env`, but be resilient to different working directories.
  const candidates = [repoRootEnv, cwdEnv, pkgEnv];
  let loaded = false;
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const { error } = dotenv.config({ path });
    if (!error) {
      loaded = true;
      break;
    }
  }
  // Missing .env is normal; surface non-ENOENT errors only.
  if (!loaded) {
    const { error } = dotenv.config();
    if (error) {
      const err = error as unknown as { code?: unknown; message?: unknown };
      const code = typeof err.code === "string" ? err.code : undefined;
      if (code !== "ENOENT") {
        console.error(`Failed to load .env: ${error.message}`);
        process.exitCode = 1;
      }
    }
  }
}

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const host = process.env.HOST ?? "127.0.0.1";

const app = createAskDbHttpServer({ port, host });
await app.listen();
console.log(`AskDB HTTP API listening on http://${app.host}:${app.port}`);
