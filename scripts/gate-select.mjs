#!/usr/bin/env node
// Lists the vitest test files related to a change set WITHOUT running them (docs/specs/test-tiers.md AC-1/AC-3).
// The module graph is vitest's own `related` selection (public Node API: globTestSpecifications /
// getRelevantTestSpecifications, the same filter `vitest related` and `vitest --changed` use). gate.mjs adds files
// that tests read or execute by name, always-run suites, suites prepared by a setupFile whose import graph changed, and
// tests that run changed code in a child process. Input: JSON { project, sources, triggers, extra, output } in the
// file named by the first argument, or on stdin. Output: JSON written to `output`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { Writable } from 'node:stream';
import { createVitest } from 'vitest/node';
import {
  ROOT,
  loadWorkspacePackages,
  referenceTriggers,
  scopeOf,
  selectByReference,
  selectBySubprocessScope,
  selectByTestDirectory,
  setupFileTargets,
  spawnsProcesses,
  subprocessEntries,
} from './gate.mjs';

const input = JSON.parse(readFileSync(process.argv[2] ?? 0, 'utf8'));
if (!['unit', 'db'].includes(input.project) || typeof input.output !== 'string')
  throw new Error('gate-select: expected { project: "unit" | "db", sources, triggers, extra, output }');
const toRelative = (file) => relative(ROOT, file).split(sep).join('/');
const toAbsolute = (file) => resolve(ROOT, file);
const changedSources = (input.sources ?? []).map(toAbsolute);
const sources = [...changedSources, ...(input.extra ?? []).map(toAbsolute)];
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

// Files reachable from `entries` through static and dynamic imports, outside node_modules: the same walk vitest's
// related filter performs from each test file, through the project's public Vite server. A file that cannot be
// transformed makes the result unknown (`complete: false`), and callers then select conservatively.
async function reachableFrom(project, entries) {
  const environment = project.vite.environments.ssr;
  const seen = new Set();
  const queue = [...entries];
  let complete = true;
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let transformed;
    try {
      transformed =
        environment.moduleGraph.getModuleById(file)?.transformResult ?? (await environment.transformRequest(file));
    } catch {
      complete = false;
      continue;
    }
    for (const dep of [...(transformed?.deps ?? []), ...(transformed?.dynamicDeps ?? [])]) {
      const path = dep.startsWith('/@fs/') ? dep.slice(4) : join(project.config.root, dep);
      if (!path.includes('node_modules') && existsSync(path)) queue.push(path);
    }
  }
  return { reached: seen, complete };
}

try {
  const all = (await vitest.globTestSpecifications()).map((spec) => toRelative(spec.moduleId)).sort();
  const missing = [...extra].filter((file) => !all.includes(file));
  if (missing.length)
    throw new Error(`gate-select: always-run suites are not ${input.project} tests: ${missing.join(', ')}`);
  const via = new Map();
  const add = (file, reason) => {
    if (!via.has(file)) via.set(file, reason);
  };
  if (sources.length)
    for (const spec of await vitest.getRelevantTestSpecifications()) {
      const file = toRelative(spec.moduleId);
      add(file, extra.has(file) ? 'always' : 'graph');
    }
  const triggers = input.triggers ?? [];
  for (const file of selectByTestDirectory(triggers, all)) add(file, 'directory');
  const read = (file) => readFileSync(toAbsolute(file), 'utf8');
  for (const file of selectByReference(referenceTriggers(triggers), all, read)) add(file, 'reference');
  const project = vitest.projects.find((candidate) => candidate.name === input.project);
  const touches = async (entries) => {
    if (!changedSources.length || !entries.length) return false;
    const { reached, complete } = await reachableFrom(project, entries);
    return !complete || changedSources.some((file) => reached.has(file));
  };
  for (const setupFile of project?.config.setupFiles ?? [])
    if (await touches([setupFile]))
      for (const file of setupFileTargets(read(toRelative(setupFile)), all)) add(file, 'setup');
  const packages = loadWorkspacePackages(ROOT);
  const spawning = all.filter((file) => spawnsProcesses(read(file)));
  for (const file of selectBySubprocessScope(triggers, spawning, packages)) add(file, 'subprocess');
  for (const file of spawning.filter((candidate) => !via.has(candidate))) {
    const entries = subprocessEntries(file, read(file), scopeOf(file, packages), (path) =>
      existsSync(toAbsolute(path)),
    );
    if (await touches(entries.map(toAbsolute))) add(file, 'subprocess');
  }
  const selected = [...via.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, reason]) => ({ file, via: reason }));
  writeFileSync(input.output, `${JSON.stringify({ project: input.project, total: all.length, selected }, null, 2)}\n`);
} finally {
  await vitest.close();
}
