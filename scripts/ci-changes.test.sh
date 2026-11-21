#!/usr/bin/env bash
# Self-test for scripts/ci-changes.sh, which decides which CI jobs a change needs. Feeds
# `classify` sample path lists, runs the run-everything cases, and diffs real commits in a
# throwaway repository, failing naming each case whose output differs. Needs bash and git.
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/ci-changes.sh"
EVERYTHING="$(printf '%s\n' docs_only=false deps=true smoke_input=true)"
failures=0

# expect <label> <expected output> <actual output>
expect() {
  if [ "$3" != "$2" ]; then
    echo "FAIL $1:"
    echo "  expected: $(echo "$2" | tr '\n' ' ')"
    echo "  actual:   $(echo "$3" | tr '\n' ' ')"
    failures=$((failures + 1))
  fi
}

# check <label> <docs_only> <deps> <smoke_input> <changed paths, one per line>
check() {
  expect "$1" "$(printf '%s\n' "docs_only=$2" "deps=$3" "smoke_input=$4")" \
    "$(printf '%s\n' "$5" | bash "${SCRIPT}" classify 2>/dev/null)"
}

# Docs-only lists.
check "docs site page" true false false "apps/docs-site/src/content/docs/guides/studio.mdx"
check "the Quickstart page, which the smoke test runs" true false true "apps/docs-site/src/content/docs/quickstart.mdx"
check "docs/ and top-level Markdown" true false false "$(printf '%s\n' docs/adrs/0001.md CONTRIBUTING.md AGENTS.md)"
check "a package README" true false true "packages/core/README.md"
check "an app README" true false true "apps/cli/README.md"
check "a nested README and a CHANGELOG" true false false "$(printf '%s\n' examples/quickstart/README.md packages/core/CHANGELOG.md)"
check "the docs site's package.json" true true false "apps/docs-site/package.json"

# Not docs-only.
check "schema artifact Markdown" false false false "fixtures/schemas/shop/orders.md"
check "source file" false false false "packages/core/src/ask.ts"
check "docs plus source" false false false "$(printf '%s\n' docs/x.md packages/core/src/ask.ts)"
check "workflow" false false false ".github/workflows/ci.yml"

# Dependency files.
check "root lockfile" false true false "pnpm-lock.yaml"
check "a package manifest" false true false "packages/core/package.json"
check "workspace file" false true false "pnpm-workspace.yaml"
check "audit config" false true false ".audit-ci.json"
check "audit prod config" false true false ".audit-ci.prod.json"
check "npmrc" false true false ".npmrc"
check "lockfile among sources" false true false "$(printf '%s\n' packages/core/src/ask.ts pnpm-lock.yaml)"
check "not a dependency file" false false false "$(printf '%s\n' scripts/package.json.md packages/core/src/pnpm-lock.ts packages/x/.audit-ci.json packages/x/.audit-ci.prod.json)"

# An empty list can't be classified, so everything runs.
expect "empty input" "${EVERYTHING}" "$(printf '' | bash "${SCRIPT}" classify 2>/dev/null)"

# Push and pull request cases that can't be diffed run everything.
expect "push from a new branch" "${EVERYTHING}" \
  "$(bash "${SCRIPT}" push 0000000000000000000000000000000000000000 HEAD 2>/dev/null)"
expect "push with no before" "${EVERYTHING}" "$(bash "${SCRIPT}" push "" HEAD 2>/dev/null)"
expect "force push" "${EVERYTHING}" "$(bash "${SCRIPT}" push HEAD HEAD true 2>/dev/null)"
expect "missing commit" "${EVERYTHING}" \
  "$(bash "${SCRIPT}" push 1234567890abcdef1234567890abcdef12345678 HEAD 2>/dev/null)"
expect "pull request with no base" "${EVERYTHING}" "$(bash "${SCRIPT}" pr "" 2>/dev/null)"
expect "unknown mode" "${EVERYTHING}" "$(bash "${SCRIPT}" 2>/dev/null)"

# Real diffs, in a throwaway repository: a docs-only commit, and a tested file moved into docs/.
REPO="$(mktemp -d)"
trap 'rm -rf "${REPO}"' EXIT
git_in() { git -C "${REPO}" -c user.name=t -c user.email=t@example.invalid "$@" >/dev/null 2>&1; }
git_in init -q -b main
mkdir -p "${REPO}/docs" "${REPO}/fixtures"
echo a >"${REPO}/fixtures/NOTES.md"
echo a >"${REPO}/docs/page.md"
git_in add -A
git_in commit -q -m base
BASE="$(git -C "${REPO}" rev-parse HEAD)"
echo b >>"${REPO}/docs/page.md"
git_in commit -qam docs
DOCS="$(git -C "${REPO}" rev-parse HEAD)"
git_in mv fixtures/NOTES.md docs/notes.md
git_in commit -qm move
MOVE="$(git -C "${REPO}" rev-parse HEAD)"
git_in update-ref refs/remotes/origin/main "${BASE}"
run_in() { (cd "${REPO}" && bash "${SCRIPT}" "$@" 2>/dev/null); }
expect "push of a docs-only commit never skips" "$(printf '%s\n' docs_only=false deps=false smoke_input=false)" \
  "$(run_in push "${BASE}" "${DOCS}")"
git_in checkout -q "${DOCS}"
expect "pull request with a docs-only commit" "$(printf '%s\n' docs_only=true deps=false smoke_input=false)" "$(run_in pr main)"
git_in checkout -q "${MOVE}"
git_in update-ref refs/remotes/origin/main "${DOCS}"
expect "pull request moving a file into docs/" "$(printf '%s\n' docs_only=false deps=false smoke_input=false)" "$(run_in pr main)"

if [ "${failures}" -ne 0 ]; then
  echo "ci-changes.test.sh: ${failures} failure(s)"
  exit 1
fi
echo "ci-changes.test.sh: ok"
