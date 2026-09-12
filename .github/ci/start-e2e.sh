#!/usr/bin/env bash
# CI-owned process lifecycle: the ephemeral runner stops both servers after this job.
set -euo pipefail
mkdir -p ci-logs
nohup pnpm --filter @daifuku/api start > ci-logs/api.log 2>&1 &
api_pid=$!
nohup pnpm --filter @daifuku/web exec vite --host 127.0.0.1 --port 5173 --strictPort > ci-logs/web.log 2>&1 &
web_pid=$!
for i in $(seq 1 90); do
  if ! kill -0 "$api_pid" 2>/dev/null || ! kill -0 "$web_pid" 2>/dev/null; then
    echo 'A fixture server exited before readiness; inspect the synthetic CI diagnostics.'
    exit 1
  fi
  if curl -fsS http://localhost:3000/health > /dev/null 2>&1 && curl -fsS http://localhost:5173/ > /dev/null 2>&1; then
    echo 'API and Web are ready.'
    exit 0
  fi
  sleep 1
done
echo 'Fixture servers did not become ready within 90 seconds.'
exit 1
