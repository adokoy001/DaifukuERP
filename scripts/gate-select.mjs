#!/usr/bin/env node
// Lists the vitest test files related to a change set WITHOUT running them (docs/specs/test-tiers.md AC-1/AC-3).
// The module graph is vitest's own `related` selection (public Node API: globTestSpecifications /
// getRelevantTestSpecifications, the same filter `vitest related` and `vitest --changed` use). gate.mjs adds files
// that tests read or execute by name and always-run suites. Input: JSON on stdin
// { project, sources, triggers, extra, output }. Output: JSON written to `output`.
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { Writable } from 'node:stream';
import { createVitest } from 'vitest/node';
import { ROOT, referenceTriggers, selectByReference, selectByTestDirectory } from './gate.mjs';

const input = JSON.parse(readFileSync(0, 'utf8'));
if (!['unit', 'db'].includes(input.project) || typeof input.output !== 'string')
  throw new Error('gate-select: expected { project: "unit" | "db", sources, triggers, extra, output }');
const toRelative = (file) => relative(ROOT, file).split(sep).join('/');
const toAbsolute = (file) => resolve(ROOT, file);
const sources = [...(input.sources ?? []), ...(input.extra ?? [])].map(toAbsolute);
const extra = new Set(input.extra ?? []);
const sink = new Writable({ write: (_chunk, _encoding, done) => done() });
const vitest = await createVitest(
  'test',
  {
    root: ROOT,
    watch: false,
    run: true,
    related: sources,
    project: [input.project],
    reporters: [],
    passWithNoTests: true,
  },
  {},
  { stdout: sink, stderr: process.stderr },
);
try {
  const all = (await vitest.globTestSpecifications()).map((spec) => toRelative(spec.moduleId)).sort();
  const via = new Map();
  if (sources.length)
    for (const spec of await vitest.getRelevantTestSpecifications()) {
      const file = toRelative(spec.moduleId);
      via.set(file, extra.has(file) ? 'always' : 'graph');
    }
  const triggers = input.triggers ?? [];
  for (const file of selectByTestDirectory(triggers, all)) if (!via.has(file)) via.set(file, 'directory');
  const read = (file) => readFileSync(toAbsolute(file), 'utf8');
  for (const file of selectByReference(referenceTriggers(triggers), all, read))
    if (!via.has(file)) via.set(file, 'reference');
  const selected = [...via.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, reason]) => ({ file, via: reason }));
  writeFileSync(input.output, `${JSON.stringify({ project: input.project, total: all.length, selected }, null, 2)}\n`);
} finally {
  await vitest.close();
}
