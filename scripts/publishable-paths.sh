#!/usr/bin/env bash
# Reads changed paths on stdin, one per line, and prints the ones that count as
# publishable for the Changesets workflow: every package.json of a published package or
# app, and every file under a publishable src/ that is not a test file. Always exits 0,
# matched or not. The workflow decides whether a printed manifest counts
# (devDependencies don't). Self-test: scripts/publishable-paths.test.sh.
#
# Publishable src/: packages/<pkg>/src/ and apps/{cli,http-api,studio}/src/.
# Test files, which no build ships, are a file name containing .test. or .spec.,
# a path segment named __tests__ or __snapshots__, and a file named test-utils.ts.
set -u

while IFS= read -r path || [ -n "${path}" ]; do
  case "${path}" in
    packages/*/package.json | apps/cli/package.json | apps/http-api/package.json | apps/studio/package.json)
      # packages/*/ must be a single segment
      rest="${path#packages/}"
      case "${path}" in packages/*) [[ "${rest%/package.json}" != */* ]] || continue ;; esac
      echo "${path}"
      continue
      ;;
    packages/*/src/* | apps/cli/src/* | apps/http-api/src/* | apps/studio/src/*) ;;
    *) continue ;;
  esac

  name="${path##*/}"
  case "${name}" in
    *.test.* | *.spec.* | test-utils.ts) continue ;;
  esac
  case "/${path}/" in
    */__tests__/* | */__snapshots__/*) continue ;;
  esac
  echo "${path}"
done
exit 0
