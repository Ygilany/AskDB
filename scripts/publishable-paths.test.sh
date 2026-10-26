#!/usr/bin/env bash
# Self-test for scripts/publishable-paths.sh, the filter the Changesets workflow uses to
# decide which changed paths count as publishable. Feeds it sample path lists and fails
# naming each path whose result differs from what is expected. Needs only bash.
set -uo pipefail

FILTER="$(cd "$(dirname "$0")" && pwd)/publishable-paths.sh"
failures=0

# check <label> <expected: newline-separated paths printed> <input: newline-separated paths>
check() {
  local label="$1" expected="$2" input="$3" actual status
  actual="$(printf '%s' "${input}" | bash "${FILTER}")"
  status=$?
  if [ "${status}" -ne 0 ]; then
    echo "FAIL ${label}: exited ${status}, expected 0"
    failures=$((failures + 1))
  fi
  if [ "${actual}" != "${expected}" ]; then
    echo "FAIL ${label}:"
    echo "  expected: ${expected:-<nothing>}"
    echo "  actual:   ${actual:-<nothing>}"
    failures=$((failures + 1))
  fi
}

# Test-only paths under each publishable src root are not printed.
for root in packages/core/src apps/cli/src apps/http-api/src apps/studio/src; do
  for rel in \
    foo.test.ts \
    nested/foo.integration.test.ts \
    foo.spec.ts \
    __tests__/foo.ts \
    nested/__tests__/helper.ts \
    __snapshots__/foo.test.ts.snap \
    nested/__snapshots__/foo.snap \
    connector/test-utils.ts \
    test-utils.ts; do
    check "${root}/${rel}" "" "${root}/${rel}"
  done
done

# A non-test source file is printed, alone and mixed into test files.
check "source alone" "packages/core/src/ask.ts" "packages/core/src/ask.ts"
check "source mixed with tests" "packages/core/src/ask.ts" \
  "$(printf '%s\n' packages/core/src/ask.test.ts packages/core/src/ask.ts packages/core/src/__tests__/x.ts)"
check "source in each app" "$(printf '%s\n' apps/cli/src/a.ts apps/http-api/src/b.ts apps/studio/src/c.tsx)" \
  "$(printf '%s\n' apps/cli/src/a.ts apps/http-api/src/b.ts apps/studio/src/c.tsx)"

# Only the file's own name is checked for .test./.spec., and directory names for the two folders.
check "dir named .test." "packages/core/src/x.test.d/ask.ts" "packages/core/src/x.test.d/ask.ts"
check "dir named .spec." "packages/core/src/latest.spec-notes/ask.ts" "packages/core/src/latest.spec-notes/ask.ts"
check "dir named like __tests__" "packages/core/src/__tests__x/ask.ts" "packages/core/src/__tests__x/ask.ts"
check "file named like test-utils" "packages/core/src/test-utils.tsx" "packages/core/src/test-utils.tsx"
check "file named like test-utils prefix" "packages/core/src/my-test-utils.ts" "packages/core/src/my-test-utils.ts"

# Manifests are always printed; the workflow decides whether they count.
check "package manifests" "$(printf '%s\n' packages/core/package.json apps/cli/package.json)" \
  "$(printf '%s\n' packages/core/package.json apps/cli/package.json)"

# Paths outside publishable sources are not printed.
check "outside publishable sources" "" \
  "$(printf '%s\n' docs/x.md apps/docs-site/src/x.ts scripts/x.sh packages/core/README.md .github/workflows/ci.yml)"

# A test-only list that also changes a manifest still prints the manifest.
check "tests plus manifest" "packages/core/package.json" \
  "$(printf '%s\n' packages/core/src/ask.test.ts packages/core/package.json)"

# Empty input prints nothing and exits 0.
check "empty input" "" ""

if [ "${failures}" -ne 0 ]; then
  echo "publishable-paths.test.sh: ${failures} failure(s)"
  exit 1
fi
echo "publishable-paths.test.sh: ok"
