#!/usr/bin/env node
// Lists the vitest test files related to a change set WITHOUT running them (docs/specs/test-tiers.md AC-1/AC-3).
// The module graph is vitest's own `related` selection (public Node API: globTestSpecifications /
// getRelevantTestSpecifications, the same filter `vitest related` and `vitest --changed` use). gate.mjs adds files
// that tests read or execute by name, always-run suites, suites prepared by a setupFile whose import graph changed, and
// tests that run changed code in a child process. With `deferSchemaSuites` (light DB), graph-selected migration/setup
// suites are deferred to full unless the change set is schema-relevant (docs/specs/db-test-startup.md). Input: JSON
// { project, sources, triggers, extra, deferSchemaSuites, output } in the file named by the first argument, or on
// stdin. Output: JSON written to `output`.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, join, posix, relative, resolve, sep } from 'node:path';
import { Writable } from 'node:stream';
import { createVitest } from 'vitest/node';
import {
  MODULE_EXTENSIONS,
  ROOT,
  buildsSchemaFromMigrations,
  declaresSchema,
  deferSchemaSuites,
  loadWorkspacePackages,
  packageOf,
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
// transformed makes the result unknown (`complete: false`), and callers then select conservatively. `within` (an
// absolute directory) limits the walk to one workspace package.
async function reachableFrom(project, entries, within = null) {
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
      if (within && !path.startsWith(`${within}${sep}`)) continue;
      if (!path.includes('node_modules') && existsSync(path)) queue.push(path);
    }
  }
  return { reached: seen, complete };
}

// Module sources of one workspace package outside its tests and build output (where schema is declared).
function packageSources(dir) {
  const files = [];
  const walk = (relativeDir) => {
    for (const entry of readdirSync(toAbsolute(relativeDir), { withFileTypes: true })) {
      const path = `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', 'test', 'e2e', '.runtime', '.stryker-tmp'].includes(entry.name)) walk(path);
      } else if (MODULE_EXTENSIONS.has(extname(entry.name)) && !/\.test\.[cm]?[jt]sx?$/.test(entry.name))
        files.push(path);
    }
  };
  walk(dir);
  return files.sort();
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
  const packages = loadWorkspacePackages(ROOT);
  const touches = async (entries) => {
    if (!changedSources.length || !entries.length) return false;
    const { reached, complete } = await reachableFrom(project, entries);
    return !complete || changedSources.some((file) => reached.has(file));
  };
  for (const setupFile of project?.config.setupFiles ?? [])
    if (await touches([setupFile]))
      for (const file of setupFileTargets(read(toRelative(setupFile)), all)) add(file, 'setup');
  const spawning = all.filter((file) => spawnsProcesses(read(file)));
  for (const file of selectBySubprocessScope(triggers, spawning, packages)) add(file, 'subprocess');
  for (const file of spawning.filter((candidate) => !via.has(candidate))) {
    const entries = subprocessEntries(file, read(file), scopeOf(file, packages), (path) =>
      existsSync(toAbsolute(path)),
    );
    if (await touches(entries.map(toAbsolute))) add(file, 'subprocess');
  }
  let selected = [...via.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, reason]) => ({ file, via: reason }));
  let deferred = [];
  let schemaReasons = [];
  if (input.deferSchemaSuites) {
    const sibling = (file) => (name) => {
      const path = posix.join(posix.dirname(file), name);
      return existsSync(toAbsolute(path)) ? read(path) : '';
    };
    const schemaSuites = new Set(all.filter((file) => buildsSchemaFromMigrations(read(file), sibling(file))));
    if (selected.some((entry) => entry.via === 'graph' && schemaSuites.has(entry.file))) {
      const changed = (input.sources ?? []).filter((path) => existsSync(toAbsolute(path)));
      const modules = changed.filter((path) => MODULE_EXTENSIONS.has(extname(path)));
      const declaring = modules.filter((path) => declaresSchema(read(path)));
      // Enum values and field lists that declarations import from services files of the same package.
      const reached = [];
      const candidates = modules.filter((path) => !declaring.includes(path));
      const dirs = new Set(candidates.map((path) => packageOf(path, packages)?.dir).filter(Boolean));
      for (const dir of dirs) {
        const declarations = packageSources(dir).filter((path) => declaresSchema(read(path)));
        if (!declarations.length) continue;
        const { reached: graph, complete } = await reachableFrom(
          project,
          declarations.map(toAbsolute),
          toAbsolute(dir),
        );
        for (const path of candidates)
          if (path.startsWith(`${dir}/`) && (!complete || graph.has(toAbsolute(path)))) reached.push(path);
      }
      ({
        selected,
        deferred,
        reasons: schemaReasons,
      } = deferSchemaSuites(selected, { changed, declaring, reached, schemaSuites, packages }));
    }
  }
  writeFileSync(
    input.output,
    `${JSON.stringify({ project: input.project, total: all.length, selected, deferred, schemaReasons }, null, 2)}\n`,
  );
} finally {
  await vitest.close();
}
