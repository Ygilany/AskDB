#!/usr/bin/env node
import { createAskDbHttpServer } from "./server.js";

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const host = process.env.HOST ?? "127.0.0.1";

const app = createAskDbHttpServer({ port, host });
await app.listen();
console.log(`AskDB HTTP API listening on http://${app.host}:${app.port}`);

