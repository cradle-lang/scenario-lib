#!/usr/bin/env bash
set -euo pipefail
scenario="${1:?Scenario ID required}"
source_root="${2:?Source checkout required}"
output="${3:?Output directory required}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source_file="$(node "$script_dir/resolve-library-scenario.mjs" "$scenario" "$source_root")"
mkdir -p "$output"
cxc --version > "$output/compiler-version.txt"
git -C "$source_root" rev-parse HEAD > "$output/revision.txt"
cxc validate -i "$source_file"
cxc compile -i "$source_file" -o "$output/scenario.yml"
node "$script_dir/scenario-report.mjs" "$output"
