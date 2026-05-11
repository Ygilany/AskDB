import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(root, "..");
const publicDir = join(packageRoot, "public");
const distDir = join(packageRoot, "dist");
const checkOnly = process.argv.includes("--check");

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
      continue;
    }
    files.push(path);
  }

  return files;
}

async function assertPublicFiles() {
  const required = ["index.html", "assets/styles.css", "assets/app.js"];

  for (const file of required) {
    const path = join(publicDir, file);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) {
      throw new Error(`Missing docs site asset: ${file}`);
    }
  }
}

await assertPublicFiles();

if (checkOnly) {
  const files = await listFiles(publicDir);
  console.log(`Docs site check passed (${files.length} files).`);
} else {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await cp(publicDir, distDir, { recursive: true });
  const files = await listFiles(distDir);
  console.log(
    `Built docs site with ${files.length} files in ${relative(process.cwd(), distDir)}.`,
  );
}
