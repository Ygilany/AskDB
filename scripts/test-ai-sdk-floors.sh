#!/usr/bin/env bash
# Runs @askdb/ai's tests, including the real-SDK contract tests that send a request
# through each provider, against the OLDEST versions its peer ranges accept.
#
# @askdb/ai declares `ai` and each `@ai-sdk/*` package as peers with wide floors
# (e.g. `^4.0.0`), while the workspace develops against the latest versions. A
# provider change that relies on something newer than the floor would pass the
# normal test run and break hosts on the floor. This script copies
# packages/ai/src into a scratch npm project, installs every peer at its floor
# (the `^x.y.z` lower bound), and runs vitest there.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d -t askdb-ai-floors-XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

node --input-type=module -e "
  import { readFileSync, writeFileSync } from 'node:fs';
  const ai = JSON.parse(readFileSync('$ROOT/packages/ai/package.json', 'utf8'));
  const root = JSON.parse(readFileSync('$ROOT/package.json', 'utf8'));
  const floor = (range) => {
    const m = /^\\^(\\d+\\.\\d+\\.\\d+)$/.exec(range);
    if (!m) throw new Error('test-ai-sdk-floors: expected a ^x.y.z peer range, got ' + range);
    return m[1];
  };
  const dependencies = {};
  for (const [name, range] of Object.entries(ai.peerDependencies)) {
    if (name === 'ai' || name.startsWith('@ai-sdk/')) dependencies[name] = floor(range);
  }
  const pkg = {
    name: 'askdb-ai-floors', private: true, type: 'module',
    dependencies,
    devDependencies: { vitest: root.devDependencies.vitest },
  };
  writeFileSync('$WORK/package.json', JSON.stringify(pkg, null, 2) + '\n');
  writeFileSync('$WORK/floors.json', JSON.stringify(dependencies));
  console.log('ai-floors: installing', JSON.stringify(dependencies));
"

cp -R "$ROOT/packages/ai/src" "$WORK/src"
cat > "$WORK/vitest.config.mjs" <<'EOF'
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"], testTimeout: 45_000 },
});
EOF

(cd "$WORK" && npm install --silent --no-audit --no-fund --no-package-lock)

# Confirm npm installed exactly the floors (a hoisting surprise would test the wrong SDK).
(cd "$WORK" && node --input-type=module -e "
  import { readFileSync } from 'node:fs';
  const floors = JSON.parse(readFileSync('floors.json', 'utf8'));
  for (const [name, version] of Object.entries(floors)) {
    const installed = JSON.parse(readFileSync('node_modules/' + name + '/package.json', 'utf8')).version;
    if (installed !== version) throw new Error('ai-floors: ' + name + ' is ' + installed + ', expected ' + version);
  }
  console.log('ai-floors: installed', JSON.stringify(floors));
")

(cd "$WORK" && npx vitest run --config vitest.config.mjs)
echo "ai-floors: OK"
