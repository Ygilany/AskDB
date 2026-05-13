import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, "..", "public");
const port = Number(process.env.PORT ?? 4310);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
]);

function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const normalized = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const filePath = normalized === "/" ? "/index.html" : normalized;
  return join(publicDir, filePath);
}

const server = createServer(async (request, response) => {
  if (!request.url) {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  let filePath = resolvePath(request.url);
  let info = await stat(filePath).catch(() => null);

  if (!info?.isFile()) {
    filePath = join(publicDir, "index.html");
    info = await stat(filePath).catch(() => null);
  }

  if (!info?.isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": contentTypes.get(extname(filePath)) ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`AskDB docs site running at http://127.0.0.1:${port}`);
});
