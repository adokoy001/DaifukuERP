#!/usr/bin/env node
// Appends one feature record to docs/metrics/features.jsonl (docs/experiment.md).
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
const rec = { date: new Date().toISOString().slice(0, 10) };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--') || a === '--') continue; // pnpm passes the bare `--` separator through
  const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const v = args[i + 1];
  rec[key] =
    v === undefined || v.startsWith('--') ? true : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === 'null' ? null : v;
  if (v !== undefined && !v.startsWith('--')) i++;
}
if (!rec.feature) {
  console.error(
    'usage: pnpm metrics:add -- --feature <slug> --module <m> --phase <n> --tokens <n|null> --agent-minutes <n> --human-minutes <n> --rework-lines <n> --gate-failures <n> --notes "..."',
  );
  process.exit(1);
}
appendFileSync(new URL('../docs/metrics/features.jsonl', import.meta.url), JSON.stringify(rec) + '\n');
console.log(JSON.stringify(rec));
