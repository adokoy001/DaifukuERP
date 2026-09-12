#!/usr/bin/env bash
# WSL/Linux entry point. Never installs OS packages, creates DB roles, or resets a database.
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$script_dir/.." && pwd)"
if ! command -v node >/dev/null || ! command -v pnpm >/dev/null; then
  printf '%s\n' 'Node.js 22以上と、リポジトリで指定されたpnpmを事前に用意してください。' >&2
  exit 1
fi
cd -- "$repo_dir"
exec pnpm exec tsx apps/api/src/setup/cli.ts "$@"
