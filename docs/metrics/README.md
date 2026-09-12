# metrics/
- `features.jsonl` — 機能ごとの1行（形式は ../experiment.md）
- `weekly.jsonl` — 週次集計（gate 失敗数、revert、escaped defects、境界違反、重複率）
追記は `pnpm metrics:add -- --feature <slug> --module <m> --phase <n> --tokens N --agent-minutes N --human-minutes N --rework-lines N --notes "..."`
