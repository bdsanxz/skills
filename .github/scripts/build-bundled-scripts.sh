#!/usr/bin/env bash
# Build every bundled script from its source in <skill>/dev/<name>/, then check it.
# A project is built when its package.json has a "build" script; its "typecheck" and
# "test" scripts run after the build when it has them. Any failure stops the run, so
# a script that does not pass its checks is never committed.
set -euo pipefail

cd "${1:-.}"
built=0
while IFS= read -r manifest; do
  project=$(dirname "$manifest")
  jq -e '.scripts.build' "$manifest" >/dev/null || continue
  echo "::group::$project"
  (
    cd "$project"
    bun install --frozen-lockfile
    bun run build
    for step in typecheck test; do
      if jq -e --arg step "$step" '.scripts[$step]' package.json >/dev/null; then
        bun run "$step"
      fi
    done
  )
  echo "::endgroup::"
  built=$((built + 1))
done < <(find . -path '*/node_modules' -prune -o -path '*/dev/*/package.json' -print | sort)
echo "Built and checked $built project(s)."
