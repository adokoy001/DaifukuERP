#!/usr/bin/env bash
# Compatibility entry point. Public bundles now contain only the clean, committed source tree.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
exec node "$REPO/scripts/bundle-source.mjs" "$@"
