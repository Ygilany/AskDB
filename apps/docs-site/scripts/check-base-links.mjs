import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const distDir = new URL("../dist", import.meta.url).pathname;
const expectedBase = (process.argv[2] ?? "/AskDB").replace(/\/$/, "");
const attributePattern = /\b(?:href|src|action|poster)=["'](\/(?!\/)[^"']*)["']/g;

async function getHtmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return getHtmlFiles(path);
      return entry.isFile() && entry.name.endsWith(".html") ? [path] : [];
    })
  );

  return files.flat();
}

function isAllowedRootPath(path) {
  return path === expectedBase || path.startsWith(`${expectedBase}/`);
}

const failures = [];

for (const file of await getHtmlFiles(distDir)) {
  const html = await readFile(file, "utf8");

  for (const match of html.matchAll(attributePattern)) {
    const value = match[1];
    if (!isAllowedRootPath(value)) {
      failures.push(`${relative(distDir, file)}: ${match[0]}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Found root-absolute links that are missing the ${expectedBase} base path:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`All root-absolute links include ${expectedBase}.`);
