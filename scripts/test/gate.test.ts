// Tier runner (docs/specs/test-tiers.md): change-set classification, escalation, base fallbacks, per-tier plans,
// preflight guidance, fail-fast semantics, dry-run and report shape. Each test name carries its AC id.
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ALWAYS_DB_SUITES,
  CHANGED_FILES_IN_TABLE,
  DEFAULT_SUITE_SECONDS,
  ESCALATION_RULES,
  E2E_DATABASE_NAME,
  FILE_ARGUMENT_LIMIT,
  GUIDANCE,
  GateUsageError,
  IDENTITY_DATABASE_NAME,
  MAX_DB_SHARDS,
  MAX_REPORTED_FILES,
  ROOT,
  SHARD_DATABASE_NAME,
  SHARD_INFIX,
  SHARD_NAME_LIMIT,
  TEST_DATABASE_NAME,
  applyPreflight,
  applySelection,
  browserFixtureEnv,
  browserPrerequisites,
  buildReport,
  buildsSchemaFromMigrations,
  classifyChanges,
  collectChangeSet,
  commandSummary,
  commandText,
  databaseUrl,
  declaresSchema,
  defaultDbShards,
  deferSchemaSuites,
  detectEscalation,
  formatTable,
  gitRunner,
  globToRegExp,
  identityStepEnv,
  loadWorkspacePackages,
  packageOf,
  parseCli,
  parseGateScript,
  parseSuiteDurations,
  parseWorkspacePatterns,
  partitionShards,
  planPhases,
  planShards,
  planSteps,
  provisionDatabaseName,
  provisionGuard,
  provisionTargets,
  referenceTriggers,
  reportFileName,
  resolveBase,
  resolveConcurrency,
  runSteps,
  scopeOf,
  scrubbedEnv,
  selectByReference,
  selectBySubprocessScope,
  selectByTestDirectory,
  setupFileTargets,
  shardDatabaseName,
  shardDatabases,
  smokePrerequisites,
  spawnsProcesses,
  subprocessEntries,
  testDatabaseProblems,
  testSummary,
  workspaceClosure,
} from '../gate.mjs';
import type { Base, Change, Git, GitResult, Options, Report, Step, Tier } from '../gate.mjs';

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
const gateScripts = parseGateScript(manifest.scripts.gate ?? '');
const packages = [
  { dir: 'kernel', name: '@daifuku/kernel', dependencies: [] },
  { dir: 'modules/sales', name: '@daifuku/mod-sales', dependencies: ['@daifuku/kernel'] },
  { dir: 'modules/banking', name: '@daifuku/mod-banking', dependencies: ['@daifuku/kernel', '@daifuku/mod-sales'] },
  { dir: 'modules/franchise', name: '@daifuku/mod-franchise', dependencies: ['@daifuku/kernel'] },
  { dir: 'apps/api', name: '@daifuku/api', dependencies: ['@daifuku/kernel', '@daifuku/mod-sales'] },
  { dir: 'apps/web', name: '@daifuku/web', dependencies: ['@daifuku/mod-banking'] },
];
const base: Base = { ref: 'origin/main', commit: 'a'.repeat(40), source: 'merge-base', fallback: false, notes: [] };
const COMMIT = 'b'.repeat(40);

function options(overrides: Partial<Options> = {}): Options {
  return {
    help: false,
    tier: 'quick',
    base: undefined,
    keepGoing: false,
    dryRun: false,
    withSmoke: false,
    withoutBrowser: false,
    provision: false,
    playwrightArgs: [],
    ...overrides,
  };
}
function changesOf(paths: readonly string[], deleted: readonly string[] = []): Change[] {
  return [...paths.map((path) => ({ path, deleted: false })), ...deleted.map((path) => ({ path, deleted: true }))];
}
function plan(tier: Tier, paths: readonly string[], extra: { deleted?: string[]; opts?: Partial<Options> } = {}) {
  const changes = changesOf(paths, extra.deleted);
  const cls = classifyChanges(changes, packages);
  const escalation = detectEscalation(changes);
  const steps = planSteps({ tier, cls, base, escalation, options: options({ tier, ...extra.opts }), gateScripts });
  return { changes, cls, escalation, steps };
}
function find<T extends Step>(steps: readonly T[], id: string): T {
  const found = steps.find((item) => item.id === id);
  if (!found) throw new Error(`missing step ${id}`);
  return found;
}
function fakeGit(responses: Record<string, string | GitResult>): Git {
  return (args) => {
    const response = responses[args.join(' ')];
    if (response === undefined) return { ok: false, stdout: '', stderr: `unexpected git ${args.join(' ')}` };
    return typeof response === 'string' ? { ok: true, stdout: response, stderr: '' } : response;
  };
}
const verify = (ref: string) => `rev-parse --verify --quiet ${ref}^{commit}`;
const fullEnv = {
  DATABASE_URL_OWNER: 'postgres://daifuku_owner:owner@127.0.0.1:5432/daifuku_e2e_test_x',
  DATABASE_URL: 'postgres://daifuku_app:app@127.0.0.1:5432/daifuku_e2e_test_x',
  E2E_PREPARE: '1',
  E2E_API_URL: 'http://localhost:3000',
  E2E_BASE_URL: 'http://localhost:5173',
  TEST_DATABASE_URL_OWNER: 'postgres://daifuku_owner:owner@127.0.0.1:5432/daifuku_test_x',
  TEST_DATABASE_URL: 'postgres://daifuku_app:app@127.0.0.1:5432/daifuku_test_x',
  GATE_IDENTITY_DATABASE_URL_OWNER: 'postgres://daifuku_owner:owner@127.0.0.1:5432/daifuku_e2e_test_enterprise_y',
  GATE_IDENTITY_DATABASE_URL: 'postgres://daifuku_app:app@127.0.0.1:5432/daifuku_e2e_test_enterprise_y',
};

// A throwaway repository with a copy of scripts/gate.mjs: ROOT follows the script, so runs stay inside it and need
// neither this checkout's .git nor its .runtime/.
function sandbox(scripts: Record<string, string>, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'daifuku-gate-sandbox-'));
  mkdirSync(join(dir, 'scripts'));
  copyFileSync(join(ROOT, 'scripts/gate.mjs'), join(dir, 'scripts/gate.mjs'));
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: 'gate-sandbox', private: true, scripts }, null, 2)}\n`,
  );
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages: []\n');
  writeFileSync(join(dir, '.gitignore'), '.runtime/\n');
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  for (const args of [
    ['init', '-q', '-b', 'main'],
    ['add', '.'],
    ['commit', '-q', '-m', 'sandbox'],
  ]) {
    const result = spawnSync(
      'git',
      ['-c', 'user.name=gate', '-c', 'user.email=gate@example.invalid', '-c', 'commit.gpgsign=false', ...args],
      { cwd: dir, encoding: 'utf8' },
    );
    if (result.status !== 0) throw new Error(result.stderr);
  }
  return dir;
}
function sandboxReport(dir: string, tier: Tier) {
  const directory = join(dir, '.runtime/gate');
  const file = existsSync(directory)
    ? readdirSync(directory).find((name) => name.endsWith(`-${tier}.json`))
    : undefined;
  return file ? (JSON.parse(readFileSync(join(directory, file), 'utf8')) as Report) : null;
}

describe('AC-15 base resolution', () => {
  it('AC-15 uses merge-base(HEAD, origin/main) by default', () => {
    const git = fakeGit({
      [verify('HEAD')]: COMMIT,
      [verify('origin/main')]: 'c'.repeat(40),
      'merge-base HEAD origin/main': `${'d'.repeat(40)}\n`,
    });
    expect(resolveBase({ git })).toEqual({
      ref: 'origin/main',
      commit: 'd'.repeat(40),
      source: 'merge-base',
      fallback: false,
      notes: [],
    });
  });
  it('AC-15 prefers --base over GATE_BASE and accepts GATE_BASE alone', () => {
    const git = fakeGit({ [verify('topic')]: 'e'.repeat(40), [verify('v1.0')]: 'f'.repeat(40) });
    expect(resolveBase({ explicit: 'topic', env: { GATE_BASE: 'v1.0' }, git })).toMatchObject({
      ref: 'topic',
      source: 'option',
    });
    expect(resolveBase({ env: { GATE_BASE: 'v1.0' }, git })).toMatchObject({
      ref: 'v1.0',
      commit: 'f'.repeat(40),
      source: 'env',
    });
  });
  it('AC-15 rejects an unknown or option-like explicit base instead of guessing', () => {
    const git = fakeGit({});
    expect(() => resolveBase({ explicit: 'no-such-ref', git })).toThrow(GateUsageError);
    expect(() => resolveBase({ env: { GATE_BASE: '--output=x' }, git })).toThrow(/not an option/);
  });
  it('AC-15 falls back to HEAD~1 without origin/main, origin/HEAD, main or an upstream', () => {
    const git = fakeGit({ [verify('HEAD')]: COMMIT, [verify('HEAD~1')]: 'c'.repeat(40) });
    const resolved = resolveBase({ git });
    expect(resolved).toMatchObject({ ref: 'HEAD~1', commit: 'c'.repeat(40), source: 'parent', fallback: true });
    expect(resolved.notes.join(' ')).toMatch(/origin\/main is not available/);
    expect(resolved.notes.join(' ')).toMatch(/only the last commit/);
  });
  it('AC-15 tries origin/HEAD, local main and the upstream through merge-base before HEAD~1', () => {
    const git = fakeGit({
      [verify('HEAD')]: COMMIT,
      [verify('main')]: 'c'.repeat(40),
      'merge-base HEAD main': `${'d'.repeat(40)}\n`,
      [verify('@{upstream}')]: 'e'.repeat(40),
      'merge-base HEAD @{upstream}': `${'e'.repeat(40)}\n`,
    });
    const resolved = resolveBase({ git });
    expect(resolved).toMatchObject({ ref: 'main', commit: 'd'.repeat(40), source: 'merge-base', fallback: true });
    expect(resolved.notes.join(' ')).toMatch(/merge-base\(HEAD, main\)/);
    const onMain = fakeGit({
      [verify('HEAD')]: COMMIT,
      [verify('main')]: COMMIT,
      'merge-base HEAD main': `${COMMIT}\n`,
      [verify('@{upstream}')]: 'e'.repeat(40),
      'merge-base HEAD @{upstream}': `${'e'.repeat(40)}\n`,
    });
    expect(resolveBase({ git: onMain })).toMatchObject({ ref: '@{upstream}', commit: 'e'.repeat(40) });
  });
  it('AC-15 falls back to HEAD~1 when merge-base fails in a shallow clone', () => {
    const git = fakeGit({
      [verify('HEAD')]: COMMIT,
      [verify('origin/main')]: 'c'.repeat(40),
      'merge-base HEAD origin/main': { ok: false, stdout: '', stderr: 'no merge base' },
      [verify('HEAD~1')]: 'd'.repeat(40),
    });
    expect(resolveBase({ git })).toMatchObject({ ref: 'HEAD~1', source: 'parent' });
  });
  it('AC-15 considers only uncommitted changes in a depth-1 clone and handles an unborn HEAD', () => {
    expect(resolveBase({ git: fakeGit({ [verify('HEAD')]: COMMIT }) })).toMatchObject({
      ref: 'HEAD',
      commit: COMMIT,
      source: 'head',
      fallback: true,
    });
    expect(resolveBase({ git: fakeGit({}) })).toMatchObject({ ref: null, commit: null, source: 'none' });
  });
  it('AC-15 marks only explicit and origin/main bases as non-fallback and warns about the others', () => {
    const git = fakeGit({ [verify('topic')]: 'e'.repeat(40) });
    expect(resolveBase({ explicit: 'topic', git }).fallback).toBe(false);
    const fallback = { ...base, ref: 'HEAD~1', source: 'parent' as const, fallback: true };
    const report = buildReport({
      tier: 'quick',
      options: options(),
      base: fallback,
      changes: [],
      cls: classifyChanges([]),
      escalation: detectEscalation([]),
      steps: [],
      startedAt: new Date(0),
      finishedAt: new Date(0),
      result: 'no-changes',
    });
    expect(report.baseFallback).toBe(true);
    expect(formatTable(report)).toMatch(/^WARNING: the base fell back to HEAD~1 \(parent\)/m);
  });
});

describe('AC-16 change set', () => {
  it('AC-16 unions committed, staged, unstaged and untracked NUL-separated paths and marks missing files deleted', () => {
    const git = fakeGit({
      [`diff --name-only --no-renames -z ${base.commit} HEAD --`]: 'modules/sales/src/a.ts\0old name.ts\0',
      'diff --name-only --no-renames -z --cached --': 'docs/日本語 メモ.md\0',
      'diff --name-only --no-renames -z --': 'modules/sales/src/a.ts\0',
      'ls-files --others --exclude-standard -z': 'new dir/new file.ts\0',
    });
    const changes = collectChangeSet({ base, git, exists: (path) => path !== 'old name.ts' });
    expect(changes).toEqual([
      { path: 'docs/日本語 メモ.md', deleted: false },
      { path: 'modules/sales/src/a.ts', deleted: false },
      { path: 'new dir/new file.ts', deleted: false },
      { path: 'old name.ts', deleted: true },
    ]);
  });
  it('AC-16 fails loudly when git cannot report changes instead of returning an empty set', () => {
    const git = fakeGit({});
    expect(() => collectChangeSet({ base, git, exists: () => true })).toThrow(/git diff/);
  });
  describe('with a real repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'daifuku-gate-'));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));
    const run = (...args: string[]) => {
      const result = spawnSync(
        'git',
        ['-c', 'user.name=gate', '-c', 'user.email=gate@example.invalid', '-c', 'commit.gpgsign=false', ...args],
        { cwd: dir, encoding: 'utf8' },
      );
      if (result.status !== 0) throw new Error(result.stderr);
    };
    it('AC-16 reports renames as delete + add, staged deletions, unstaged edits and untracked names with spaces', () => {
      run('init', '-q', '-b', 'main');
      for (const name of ['a.ts', 'd.ts', 'e.ts']) writeFileSync(join(dir, name), `export const ${name[0]} = 1;\n`);
      run('add', '.');
      run('commit', '-q', '-m', 'base');
      run('mv', 'a.ts', 'b c.ts');
      run('commit', '-q', '-m', 'rename');
      run('rm', '-q', 'd.ts');
      writeFileSync(join(dir, 'e.ts'), 'export const e = 2;\n');
      writeFileSync(join(dir, 'new ü.ts'), 'export const n = 1;\n');
      const git = gitRunner(dir);
      const resolved = resolveBase({ git });
      expect(resolved.source).toBe('parent');
      const changes = collectChangeSet({ base: resolved, git, exists: (path) => existsSync(join(dir, path)) });
      expect(changes).toEqual([
        { path: 'a.ts', deleted: true },
        { path: 'b c.ts', deleted: false },
        { path: 'd.ts', deleted: true },
        { path: 'e.ts', deleted: false },
        { path: 'new ü.ts', deleted: false },
      ]);
    });
    it('AC-15 AC-16 keeps every commit of a topic branch without a remote by using merge-base with local main', () => {
      const topic = mkdtempSync(join(tmpdir(), 'daifuku-gate-topic-'));
      try {
        const git = (...args: string[]) => {
          const result = spawnSync(
            'git',
            ['-c', 'user.name=gate', '-c', 'user.email=gate@example.invalid', '-c', 'commit.gpgsign=false', ...args],
            { cwd: topic, encoding: 'utf8' },
          );
          if (result.status !== 0) throw new Error(result.stderr);
        };
        git('init', '-q', '-b', 'main');
        mkdirSync(join(topic, 'a'));
        writeFileSync(join(topic, 'a/old.ts'), 'export const a = 1;\n');
        git('add', '.');
        git('commit', '-q', '-m', 'base');
        git('checkout', '-q', '-b', 'topic');
        git('mv', 'a/old.ts', 'a/new.ts');
        git('commit', '-q', '-m', 'rename');
        writeFileSync(join(topic, 'second.ts'), 'export const s = 1;\n');
        git('add', '.');
        git('commit', '-q', '-m', 'second');
        const runner = gitRunner(topic);
        const resolved = resolveBase({ git: runner });
        expect(resolved).toMatchObject({ ref: 'main', source: 'merge-base', fallback: true });
        const changes = collectChangeSet({
          base: resolved,
          git: runner,
          exists: (path) => existsSync(join(topic, path)),
        });
        expect(changes.map((change) => change.path)).toEqual(['a/new.ts', 'a/old.ts', 'second.ts']);
      } finally {
        rmSync(topic, { recursive: true, force: true });
      }
    });
  });
});

describe('package mapping', () => {
  it('AC-1 maps changed paths to workspace packages from pnpm-workspace.yaml', () => {
    expect(parseWorkspacePatterns("packages:\n  - kernel\n  - 'modules/*' # comment\n  - apps/*\n")).toEqual([
      'kernel',
      'modules/*',
      'apps/*',
    ]);
    expect(packageOf('modules/sales/src/index.ts', packages)?.name).toBe('@daifuku/mod-sales');
    expect(packageOf('docs/specs/test-tiers.md', packages)).toBeNull();
    const real = loadWorkspacePackages(ROOT);
    expect(real.find((pkg) => pkg.dir === 'apps/web')?.name).toBe('@daifuku/web');
    expect(real.find((pkg) => pkg.dir === 'kernel')?.name).toBe('@daifuku/kernel');
  });
});

describe('AC-1 quick plan', () => {
  it('AC-1 limits format and lint to changed files, runs root typecheck and selects related unit tests', () => {
    const { steps, cls } = plan('quick', ['modules/sales/src/services/recalculate.ts']);
    expect(steps.map((item) => item.id)).toEqual([
      'format',
      'docs',
      'assurance',
      'eslint',
      'boundaries',
      'typecheck',
      'typecheck:api',
      'typecheck:web',
      'unit',
      'deploy',
    ]);
    expect(commandText(find(steps, 'format').command)).toBe(
      'pnpm exec prettier --check ./modules/sales/src/services/recalculate.ts',
    );
    expect(commandText(find(steps, 'eslint').command)).toBe(
      'pnpm exec eslint --no-warn-ignored ./modules/sales/src/services/recalculate.ts',
    );
    expect(commandText(find(steps, 'typecheck').command)).toBe('pnpm typecheck');
    expect(commandText(find(steps, 'assurance').command)).toBe(
      `node scripts/check-assurance.mjs --changed ${base.commit}`,
    );
    expect(commandText(find(steps, 'typecheck:api').command)).toBe('pnpm --filter @daifuku/api typecheck');
    expect(commandText(find(steps, 'typecheck:web').command)).toBe('pnpm --filter @daifuku/web typecheck');
    expect(find(steps, 'deploy').skip?.result).toBe('skipped');
    expect(find(steps, 'unit').selection).toEqual({
      project: 'unit',
      sources: ['modules/sales/src/services/recalculate.ts'],
      triggers: cls.all,
      extra: [],
    });
    expect(cls.packages).toEqual(['@daifuku/mod-sales']);
  });
  it('AC-1 adds the API or Web typecheck when that app or a workspace package it imports changed', () => {
    expect(commandText(find(plan('quick', ['apps/web/src/pages/home-page.tsx']).steps, 'typecheck:web').command)).toBe(
      'pnpm --filter @daifuku/web typecheck',
    );
    expect(find(plan('quick', ['apps/web/src/pages/home-page.tsx']).steps, 'typecheck:api').skip).not.toBeNull();
    expect(commandText(find(plan('quick', ['apps/api/test/api.db.test.ts']).steps, 'typecheck:api').command)).toBe(
      'pnpm --filter @daifuku/api typecheck',
    );
    expect(find(plan('quick', ['apps/web/src/styles.css']).steps, 'typecheck:web').skip?.reason).toBe(
      'apps/web and the workspace packages it imports unchanged',
    );
    // kernel is imported by both apps (apps/api/test is typechecked only by the API typecheck).
    const kernel = plan('quick', ['kernel/src/testing.ts']).steps;
    expect(find(kernel, 'typecheck:api').skip).toBeNull();
    expect(find(kernel, 'typecheck:web').skip).toBeNull();
    const banking = plan('quick', ['modules/banking/src/matching.ts']).steps;
    expect(find(banking, 'typecheck:api').skip).not.toBeNull();
    expect(find(banking, 'typecheck:web').skip).toBeNull();
    const franchise = plan('quick', ['modules/franchise/src/index.ts']).steps;
    expect(find(franchise, 'typecheck:api').skip).not.toBeNull();
    expect(find(franchise, 'typecheck:web').skip).not.toBeNull();
    for (const config of ['tsconfig.base.json', 'modules/franchise/package.json', 'pnpm-lock.yaml']) {
      const steps = plan('quick', [config]).steps;
      expect(find(steps, 'typecheck').skip, config).toBeNull();
      expect(find(steps, 'typecheck:api').skip, config).toBeNull();
      expect(find(steps, 'typecheck:web').skip, config).toBeNull();
    }
  });
  it('AC-1 follows workspace dependencies transitively from the app packages', () => {
    expect(workspaceClosure('@daifuku/web', packages).sort()).toEqual([
      'apps/web',
      'kernel',
      'modules/banking',
      'modules/sales',
    ]);
    const real = loadWorkspacePackages(ROOT);
    const api = workspaceClosure('@daifuku/api', real);
    expect(api).toContain('kernel');
    expect(api).toContain('l10n/jp');
    expect(real.find((pkg) => pkg.dir === 'apps/web')?.dependencies).toContain('@daifuku/mod-banking');
  });
  it('AC-1 runs documentation and ledger checks for a Markdown-only change without typecheck', () => {
    const { steps } = plan('quick', ['docs/conventions/testing.md']);
    expect(find(steps, 'docs').command).not.toBeNull();
    expect(find(steps, 'typecheck').skip?.reason).toMatch(/no TypeScript-relevant change/);
    expect(find(steps, 'format').skip?.result).toBe('no-target');
    expect(find(steps, 'boundaries').skip).not.toBeNull();
  });
  it('AC-1 widens a file-limited step to the whole repository when its configuration changed', () => {
    const { steps } = plan('quick', ['package.json', 'modules/sales/src/index.ts']);
    expect(commandText(find(steps, 'format').command)).toBe('pnpm format:check');
    expect(commandText(find(steps, 'eslint').command)).toBe('pnpm exec eslint .');
    expect(commandText(find(steps, 'unit').command)).toBe('pnpm test');
    expect(find(steps, 'unit').note).toMatch(/package\.json/);
  });
  it('AC-1 uses whole-repository commands when the file list exceeds the argument limit', () => {
    const many = Array.from(
      { length: FILE_ARGUMENT_LIMIT + 1 },
      (_, index) => `modules/sales/src/generated-${index}.ts`,
    );
    const { steps } = plan('quick', many);
    expect(commandText(find(steps, 'format').command)).toBe('pnpm format:check');
    expect(find(steps, 'format').note).toMatch(/whole repository/);
  });
  it('AC-1 runs deployment tests when release tooling changed', () => {
    expect(commandText(find(plan('quick', ['deploy/runtime.mjs']).steps, 'deploy').command)).toBe('pnpm test:deploy');
    expect(commandText(find(plan('quick', ['scripts/build-api.mjs']).steps, 'deploy').command)).toBe(
      'pnpm test:deploy',
    );
  });
});

describe('AC-2 empty change set', () => {
  it('AC-2 plans no quick steps and reports no-changes', () => {
    const { steps, changes, cls, escalation } = plan('quick', []);
    expect(steps).toEqual([]);
    const report = buildReport({
      tier: 'quick',
      options: options(),
      base,
      changes,
      cls,
      escalation,
      steps: [],
      startedAt: new Date(0),
      finishedAt: new Date(1000),
      result: 'no-changes',
    });
    expect(report).toMatchObject({ result: 'no-changes', changed: { count: 0 }, steps: [] });
  });
});

describe('AC-3 light plan', () => {
  it('AC-3 runs whole static checks with both app typechecks, every unit test and related DB suites plus the kernel sentinels', () => {
    const { steps } = plan('light', ['modules/franchise/src/index.ts']);
    expect(steps.map((item) => [item.id, commandText(item.command)])).toEqual([
      ['format', 'pnpm format:check'],
      ['docs', 'pnpm docs:check'],
      ['assurance', `node scripts/check-assurance.mjs --changed ${base.commit}`],
      ['typecheck', 'pnpm typecheck'],
      ['typecheck:api', 'pnpm --filter @daifuku/api typecheck'],
      ['typecheck:web', 'pnpm --filter @daifuku/web typecheck'],
      ['lint', 'pnpm lint'],
      ['unit', 'pnpm test'],
      ['db', ''],
      ['deploy', 'pnpm test:deploy'],
    ]);
    expect(find(steps, 'db').selection).toMatchObject({
      project: 'db',
      sources: ['modules/franchise/src/index.ts'],
      extra: [...ALWAYS_DB_SUITES],
    });
  });
  it('AC-3 keeps the four kernel sentinel suites as real files', () => {
    for (const file of ALWAYS_DB_SUITES) expect(existsSync(join(ROOT, file))).toBe(true);
  });
  it('AC-3 runs exactly the selected DB files by absolute path', () => {
    const { steps } = plan('light', ['modules/banking/src/matching.ts']);
    const selected = applySelection(
      find(steps, 'db'),
      {
        project: 'db',
        total: 116,
        selected: [
          { file: 'kernel/test/foundation.db.test.ts', via: 'always' },
          { file: 'modules/banking/test/banking.db.test.ts', via: 'graph' },
        ],
      },
      '/repo',
    );
    expect(commandText(selected.command)).toBe(
      'pnpm exec vitest run --project db /repo/kernel/test/foundation.db.test.ts /repo/modules/banking/test/banking.db.test.ts',
    );
    expect(selected.selected).toEqual({ files: 2, total: 116, via: { always: 1, graph: 1 } });
    expect(commandSummary(selected.command)).toBe('pnpm exec vitest run --project db <2 files>');
  });
});

describe('db-test-startup AC-8 AC-9 AC-10 light defers migration/setup DB suites without a schema-relevant change', () => {
  const schemaSuites = new Set([
    'apps/api/test/migrations.db.test.ts',
    'apps/api/test/upgrade.db.test.ts',
    'apps/api/test/boolean-migration.db.test.ts',
  ]);
  const selected = [
    { file: 'apps/api/test/api.db.test.ts', via: 'graph' },
    { file: 'apps/api/test/boolean-migration.db.test.ts', via: 'graph' },
    { file: 'apps/api/test/migrations.db.test.ts', via: 'graph' },
    { file: 'apps/api/test/upgrade.db.test.ts', via: 'reference' },
    { file: 'kernel/test/foundation.db.test.ts', via: 'always' },
    { file: 'modules/sales/test/sales.db.test.ts', via: 'graph' },
  ];
  it('AC-8 recognises the suites that build their schema from the committed migrations from their source', () => {
    const suites = readdirSync(join(ROOT, 'apps/api/test'))
      .filter((name) => name.endsWith('.db.test.ts'))
      .map((name) => `apps/api/test/${name}`);
    const sibling = (name: string) => {
      const path = join(ROOT, 'apps/api/test', name);
      return existsSync(path) ? readFileSync(path, 'utf8') : '';
    };
    const detected = suites.filter((file) =>
      buildsSchemaFromMigrations(readFileSync(join(ROOT, file), 'utf8'), sibling),
    );
    // test-tiers named these nine (four migrate through ./legacy-fixture.ts); industry-templates also migrates a
    // populated legacy schema. Exactly these ten today; a new migration suite is picked up by the same rule.
    expect(detected).toEqual(
      expect.arrayContaining([
        'apps/api/test/boolean-migration.db.test.ts',
        'apps/api/test/commerce-finance-migration.db.test.ts',
        'apps/api/test/edge-migration.db.test.ts',
        'apps/api/test/enterprise-migration.db.test.ts',
        'apps/api/test/ext-index-migration.db.test.ts',
        'apps/api/test/operations-migration.db.test.ts',
        'apps/api/test/shift-migration.db.test.ts',
        'apps/api/test/migrations.db.test.ts',
        'apps/api/test/upgrade.db.test.ts',
        'apps/api/test/industry-templates.db.test.ts',
      ]),
    );
    // None of them uses the registry-built test schema; every other apps/api DB suite does.
    for (const file of suites) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      expect(detected.includes(file) ? !/\bfreshDb\(/.test(text) : true, file).toBe(true);
    }
    expect(detected).toHaveLength(10);
    expect(buildsSchemaFromMigrations('await freshDb();')).toBe(false);
    expect(
      buildsSchemaFromMigrations("import { seed } from './helper.ts';", () => 'await runMigrations(owner, dir);'),
    ).toBe(true);
    // Only helpers next to the suite count; a package import is not followed.
    expect(buildsSchemaFromMigrations("import { x } from '@daifuku/kernel';", () => 'runMigrations(')).toBe(false);
  });
  it('AC-9 recognises schema declarations: entities, documents, packs and system tables', () => {
    expect(declaresSchema(readFileSync(join(ROOT, 'modules/sales/src/entities/sales-invoice.ts'), 'utf8'))).toBe(true);
    expect(declaresSchema(readFileSync(join(ROOT, 'packs/retail/src/pack.ts'), 'utf8'))).toBe(true);
    expect(declaresSchema("registry.registerSystemTable('tenants', tenants);")).toBe(true);
    // registry.registerExt is the documented API for ext fields outside packs (equality indexes change the DDL).
    expect(declaresSchema("registry.registerExt('partner', { code: f.text() }, { source: 'l10n:jp' });")).toBe(true);
    expect(declaresSchema(readFileSync(join(ROOT, 'modules/sales/src/settings.ts'), 'utf8'))).toBe(false);
    expect(declaresSchema('// defineEntity is mentioned without a call')).toBe(false);
  });
  it('AC-8 defers graph-selected migration/setup suites when nothing schema-relevant changed and keeps the rest', () => {
    const result = deferSchemaSuites(selected, {
      changed: ['modules/sales/src/settings.ts'],
      schemaSuites,
      packages: packages,
    });
    expect(result.selected.map((entry) => entry.file)).toEqual([
      'apps/api/test/api.db.test.ts',
      'apps/api/test/upgrade.db.test.ts', // selected by the reference rule, not only by the graph
      'kernel/test/foundation.db.test.ts',
      'modules/sales/test/sales.db.test.ts',
    ]);
    expect(result.deferred.map((entry) => entry.file)).toEqual([
      'apps/api/test/boolean-migration.db.test.ts',
      'apps/api/test/migrations.db.test.ts',
    ]);
    expect(result.reasons).toEqual([]);
  });
  it('AC-8 keeps a migration/setup suite that another rule selected besides the module graph', () => {
    const both = [
      { file: 'apps/api/test/migrations.db.test.ts', via: 'graph', reasons: ['graph', 'subprocess'] },
      { file: 'apps/api/test/boolean-migration.db.test.ts', via: 'graph', reasons: ['graph'] },
    ];
    const result = deferSchemaSuites(both, { changed: ['modules/sales/src/settings.ts'], schemaSuites, packages });
    expect(result.selected.map((entry) => entry.file)).toEqual(['apps/api/test/migrations.db.test.ts']);
    expect(result.deferred.map((entry) => entry.file)).toEqual(['apps/api/test/boolean-migration.db.test.ts']);
  });
  it.each([
    [
      'declares schema',
      {
        changed: ['modules/sales/src/entities/sales-invoice.ts'],
        declaring: ['modules/sales/src/entities/sales-invoice.ts'],
      },
      /declares entities/,
    ],
    [
      'is imported by a declaration of its package',
      { changed: ['modules/sales/src/services/statuses.ts'], reached: ['modules/sales/src/services/statuses.ts'] },
      /imported by a schema declaration/,
    ],
    [
      'lies inside the suites package (fixtures, setup code, the suite itself)',
      { changed: ['apps/api/test/legacy-fixture.ts'] },
      /inside apps\/api/,
    ],
  ])('AC-9 keeps them when a changed path %s', (_label, input, why) => {
    const result = deferSchemaSuites(selected, { ...input, schemaSuites, packages: packages });
    expect(result.deferred).toEqual([]);
    expect(result.selected).toEqual(selected);
    expect(result.reasons[0]?.why).toMatch(why);
  });
  it('AC-8 asks for deferral only in the light DB selection, never when light escalates to every DB suite', () => {
    expect(find(plan('light', ['modules/sales/src/settings.ts']).steps, 'db').selection).toMatchObject({
      deferSchemaSuites: true,
    });
    expect(
      find(plan('quick', ['modules/sales/src/settings.ts']).steps, 'unit').selection?.deferSchemaSuites,
    ).toBeUndefined();
    expect(commandText(find(plan('light', ['apps/api/drizzle/migrations/0030_x.sql']).steps, 'db').command)).toBe(
      'pnpm test:db',
    );
    expect(commandText(find(plan('full', ['modules/sales/src/settings.ts']).steps, 'db').command)).toBe('pnpm test:db');
    // GATE_DEFER_SCHEMA_SUITES=0 (passed in as options.deferSchemaSuites = false) keeps the plain module-graph selection.
    expect(
      find(plan('light', ['modules/sales/src/settings.ts'], { opts: { deferSchemaSuites: false } }).steps, 'db')
        .selection?.deferSchemaSuites,
    ).toBeUndefined();
  });
  it('AC-10 reports deferred suites in the step, the table, the hints and the JSON report', () => {
    const { steps, changes, cls, escalation } = plan('light', ['modules/sales/src/settings.ts']);
    const db = applySelection(
      { ...find(steps, 'db'), note: 'recreates daifuku_test_x on 127.0.0.1:5432' },
      {
        project: 'db',
        total: 116,
        selected: [{ file: 'modules/sales/test/sales.db.test.ts', via: 'graph' }],
        deferred: [{ file: 'apps/api/test/migrations.db.test.ts', reason: 'no schema-relevant change' }],
      },
      '/repo',
    );
    expect(db.selected).toEqual({ files: 1, total: 116, via: { graph: 1 }, deferred: 1 });
    expect(db.deferredFiles).toEqual(['apps/api/test/migrations.db.test.ts']);
    expect(db.note).toMatch(
      /^recreates daifuku_test_x on 127\.0\.0\.1:5432; deferred 1 migration\/setup suite to full/,
    );
    expect(commandText(db.command)).toBe('pnpm exec vitest run --project db /repo/modules/sales/test/sales.db.test.ts');
    const report = buildReport({
      tier: 'light',
      options: options({ tier: 'light' }),
      base,
      changes,
      cls,
      escalation,
      steps: steps.map((item) =>
        item.id === 'db' ? { ...db, result: 'passed', seconds: 1 } : { ...item, result: 'passed', seconds: 1 },
      ),
      startedAt: new Date(0),
      finishedAt: new Date(0),
      result: 'passed',
    });
    expect(report.steps.find((item) => item.id === 'db')).toMatchObject({
      selected: { deferred: 1 },
      deferred: ['apps/api/test/migrations.db.test.ts'],
    });
    expect(report.hints.join(' ')).toMatch(
      /light deferred 1 migration\/setup DB suite .*pnpm gate:full and pnpm test:db run them/,
    );
    expect(formatTable(report)).toMatch(/^db\s+passed\s+1\.0\s+1\/116 files \(\+1 deferred\)/m);
  });
  it('AC-10 says why the migration/setup suites ran when a schema-relevant change kept them', () => {
    const db = applySelection(
      { ...find(plan('light', ['modules/sales/src/entities/sales-invoice.ts']).steps, 'db'), note: null },
      {
        project: 'db',
        total: 116,
        selected: [{ file: 'apps/api/test/migrations.db.test.ts', via: 'graph' }],
        deferred: [],
        schemaReasons: [
          {
            path: 'modules/sales/src/entities/sales-invoice.ts',
            why: 'declares entities, pack ext fields or system tables',
          },
        ],
      },
      '/repo',
    );
    expect(db.deferredFiles).toBeUndefined();
    expect(db.note).toBe(
      'ran the migration/setup suites because modules/sales/src/entities/sales-invoice.ts declares entities, pack ext ' +
        'fields or system tables',
    );
  });
});

describe('AC-4 escalation', () => {
  // One example path per rule; the test below fails when a rule is added without an example.
  const examples: Record<string, string> = {
    'kernel/**': 'kernel/src/decimal.ts',
    'apps/api/drizzle/**': 'apps/api/drizzle/migrations/0001_init.sql',
    'apps/api/src/db/**': 'apps/api/src/db/reset.ts',
    'apps/api/src/modules.ts': 'apps/api/src/modules.ts',
    'apps/api/test/payroll-provider-setup.ts': 'apps/api/test/payroll-provider-setup.ts',
    'vitest.config.mts': 'vitest.config.mts',
    '**/package.json': 'modules/sales/package.json',
    'pnpm-lock.yaml': 'pnpm-lock.yaml',
    'pnpm-workspace.yaml': 'pnpm-workspace.yaml',
    '.npmrc': '.npmrc',
    '**/tsconfig*.json': 'apps/web/tsconfig.json',
    'eslint.config.js': 'eslint.config.js',
    '.dependency-cruiser.cjs': '.dependency-cruiser.cjs',
    '.prettierrc.json': '.prettierrc.json',
    '.prettierignore': '.prettierignore',
    'turbo.json': 'turbo.json',
    '.github/**': '.github/workflows/ci.yml',
    'apps/web/playwright.config.ts': 'apps/web/playwright.config.ts',
    'apps/web/vite.config.ts': 'apps/web/vite.config.ts',
    'apps/web/index.html': 'apps/web/index.html',
    'scripts/test-identity-e2e.mjs': 'scripts/test-identity-e2e.mjs',
    'scripts/gate.mjs': 'scripts/gate.mjs',
    'scripts/gate-select.mjs': 'scripts/gate-select.mjs',
  };
  it('AC-4 every escalation rule matches its example path and is the rule reported for it', () => {
    expect(Object.keys(examples).sort()).toEqual(ESCALATION_RULES.map((rule) => rule.pattern).sort());
    for (const rule of ESCALATION_RULES) {
      const example = examples[rule.pattern] ?? '';
      expect(detectEscalation(changesOf([example])).reasons[0]?.rule, example).toBe(rule.pattern);
    }
    expect(globToRegExp('**/tsconfig*.json').test('tsconfig.json')).toBe(true);
    expect(globToRegExp('kernel/**').test('kernelx/src/a.ts')).toBe(false);
  });
  it.each([
    'modules/sales/src/index.ts',
    'apps/web/src/pages/home-page.tsx',
    'docs/specs/test-tiers.md',
    'scripts/metrics-add.mjs',
    '.github/ci/README.md',
  ])('AC-4 does not escalate %s', (path) => {
    expect(detectEscalation(changesOf([path])).required).toBe(false);
  });
  it('AC-4 widens light DB suites only for changes that can alter DB behaviour outside the module graph', () => {
    const widening = ESCALATION_RULES.filter((rule) => rule.widenDb).map((rule) => rule.pattern);
    expect(widening).toEqual([
      'kernel/**',
      'apps/api/drizzle/**',
      'apps/api/src/db/**',
      'apps/api/src/modules.ts',
      'apps/api/test/payroll-provider-setup.ts',
      'vitest.config.mts',
      '**/package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '.npmrc',
      '**/tsconfig*.json',
    ]);
    for (const path of ['.prettierignore', '.github/workflows/ci.yml', 'eslint.config.js', 'scripts/gate.mjs']) {
      const light = plan('light', [path]);
      expect(light.escalation, path).toMatchObject({ required: true, widenDb: false });
      expect(find(light.steps, 'db').selection, path).not.toBeNull();
    }
  });
  it('AC-4 light runs every DB suite for kernel changes while quick keeps its steps and reports the notice', () => {
    const light = plan('light', ['kernel/src/decimal.ts']);
    expect(commandText(find(light.steps, 'db').command)).toBe('pnpm test:db');
    expect(light.escalation.reasons).toEqual([
      { path: 'kernel/src/decimal.ts', rule: 'kernel/**', why: expect.any(String), widenDb: true },
    ]);
    const quick = plan('quick', ['kernel/src/decimal.ts']);
    expect(find(quick.steps, 'unit').selection).not.toBeNull();
    const report = buildReport({
      tier: 'quick',
      options: options(),
      base,
      changes: quick.changes,
      cls: quick.cls,
      escalation: quick.escalation,
      steps: quick.steps.map((item) => ({ ...item, result: 'planned' })),
      startedAt: new Date(0),
      finishedAt: new Date(0),
      result: 'dry-run',
    });
    expect(report.escalation).toMatchObject({
      required: true,
      widenDb: true,
      message: 'includes changes that need full regression',
    });
    expect(report.hints.join(' ')).toMatch(/pnpm gate:full/);
  });
  it('AC-4 treats deleted sources as escalation and widens quick unit selection to every test', () => {
    const { steps, escalation } = plan('quick', [], {
      deleted: ['modules/sales/src/services/aging.ts', 'modules/sales/test/old.test.ts', 'docs/old.md'],
    });
    expect(escalation.reasons.map((reason) => [reason.path, reason.rule])).toEqual([
      ['modules/sales/src/services/aging.ts', 'deleted-source'],
    ]);
    expect(commandText(find(steps, 'unit').command)).toBe('pnpm test');
    const light = plan('light', [], { deleted: ['modules/sales/src/services/aging.ts'] });
    expect(commandText(find(light.steps, 'db').command)).toBe('pnpm test:db');
  });
});

describe('AC-5 full plan', () => {
  it('AC-5 runs every pnpm gate step in order, then API/Web/edge builds, browser and identity suites', () => {
    expect(gateScripts).toEqual([
      'format:check',
      'typecheck',
      'lint',
      'test',
      'test:db',
      'test:deploy',
      'docs:check',
      'verify:assurance',
    ]);
    const { steps } = plan('full', ['modules/sales/src/index.ts']);
    expect(steps.map((item) => commandText(item.command))).toEqual([
      'pnpm format:check',
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test',
      'pnpm test:db',
      'pnpm test:deploy',
      'pnpm docs:check',
      'pnpm verify:assurance',
      'pnpm --filter @daifuku/api typecheck',
      'pnpm build:api',
      'pnpm --filter @daifuku/edge build',
      'pnpm --filter @daifuku/web typecheck',
      'pnpm --filter @daifuku/web build',
      'pnpm --filter @daifuku/web exec playwright test --reporter=list',
      'pnpm test:identity:e2e',
    ]);
  });
  it('AC-5 falls back to pnpm gate as one step when the gate script is not a plain chain', () => {
    expect(parseGateScript('pnpm a && node x.mjs')).toBeNull();
    const steps = planSteps({
      tier: 'full',
      cls: classifyChanges([]),
      base,
      escalation: detectEscalation([]),
      options: options({ tier: 'full' }),
      gateScripts: null,
    });
    expect(commandText(find(steps, 'gate').command)).toBe('pnpm gate');
  });
  it('AC-5 forwards extra Playwright arguments and inserts provisioning before the browser suite', () => {
    const { steps } = plan('full', [], { opts: { provision: true, playwrightArgs: ['--grep', '@smoke'] } });
    const ids = steps.map((item) => item.id);
    expect(ids.slice(-3)).toEqual(['browser:prepare', 'browser', 'identity']);
    expect(commandText(find(steps, 'browser').command)).toBe(
      'pnpm --filter @daifuku/web exec playwright test --reporter=list --grep @smoke',
    );
  });
});

describe('AC-6 browser prerequisites', () => {
  it('AC-6 blocks browser and identity suites without fixture variables and fails before running anything', async () => {
    const { steps } = plan('full', []);
    const checked = applyPreflight(steps, {
      env: { TEST_DATABASE_URL_OWNER: fullEnv.TEST_DATABASE_URL_OWNER, TEST_DATABASE_URL: fullEnv.TEST_DATABASE_URL },
      options: options({ tier: 'full' }),
      reach: {},
    });
    expect(find(checked, 'browser').blocked).toContain(GUIDANCE.browser);
    expect(find(checked, 'browser').blocked).toMatch(/CONTRIBUTING\.md/);
    expect(find(checked, 'identity').blocked).toBe(GUIDANCE.identity);
    let executed = 0;
    const outcome = await runSteps(checked, {
      execute: async () => {
        executed += 1;
        return { ok: true };
      },
    });
    expect(executed).toBe(0);
    expect(outcome.ok).toBe(false);
    expect(find(outcome.steps, 'browser')).toMatchObject({ result: 'failed' });
    expect(find(outcome.steps, 'format')).toMatchObject({
      result: 'not-run',
      reason: 'missing prerequisite for browser',
    });
  });
  it('AC-6 requires reachable servers, not only variables', () => {
    expect(browserPrerequisites(fullEnv, { api: true, web: false })).toEqual(['reachable http://localhost:5173']);
    expect(browserPrerequisites(fullEnv, { api: true, web: true })).toEqual([]);
    const checked = applyPreflight(plan('full', []).steps, {
      env: fullEnv,
      options: options({ tier: 'full' }),
      reach: { api: true, web: true },
    });
    expect(checked.filter((item) => item.blocked)).toEqual([]);
  });
  it('AC-6 --without-browser skips both suites and reports partial: true', () => {
    const run = plan('full', [], { opts: { withoutBrowser: true } });
    expect(find(run.steps, 'browser').skip?.reason).toMatch(/--without-browser/);
    const report = buildReport({
      tier: 'full',
      options: options({ tier: 'full', withoutBrowser: true }),
      base,
      changes: run.changes,
      cls: run.cls,
      escalation: run.escalation,
      steps: run.steps.map((item) => ({ ...item, result: item.skip?.result ?? 'passed', seconds: 1 })),
      startedAt: new Date(0),
      finishedAt: new Date(2000),
      result: 'passed',
    });
    expect(report.partial).toBe(true);
    expect(report.skipped.map((item) => item.id)).toEqual(['browser', 'identity']);
    expect(formatTable(report)).toMatch(/partial: true/);
  });
  it('AC-6 AC-17 provisioning needs loopback TEST URLs on one server with the daifuku_app role', () => {
    expect(provisionTargets(fullEnv)?.owner.hostname).toBe('127.0.0.1');
    expect(
      provisionTargets({
        ...fullEnv,
        TEST_DATABASE_URL_OWNER: 'postgres://daifuku_owner:owner@db.example.test:5432/x',
      }),
    ).toBeNull();
    expect(provisionTargets({ ...fullEnv, TEST_DATABASE_URL: 'postgres://other:app@127.0.0.1:5432/x' })).toBeNull();
    expect(
      provisionTargets({ ...fullEnv, TEST_DATABASE_URL: 'postgres://daifuku_app:app@127.0.0.1:5433/x' }),
    ).toBeNull();
    expect(
      provisionTargets({
        ...fullEnv,
        TEST_DATABASE_URL_OWNER: 'postgres://daifuku_owner:owner@127.0.0.1:5432/x?host=/tmp',
      }),
    ).toBeNull();
    const steps = plan('full', [], { opts: { provision: true } }).steps;
    const blocked = applyPreflight(steps, {
      env: { TEST_DATABASE_URL_OWNER: 'x', TEST_DATABASE_URL: 'y' },
      options: options({ tier: 'full', provision: true }),
    });
    expect(find(blocked, 'browser:prepare').blocked).toBe(GUIDANCE.provision);
    expect(find(blocked, 'browser').blocked).toBeNull();
    const ready = applyPreflight(steps, { env: fullEnv, options: options({ tier: 'full', provision: true }) });
    expect(ready.filter((item) => item.blocked)).toEqual([]);
  });
});

describe('AC-17 provisioned database names', () => {
  it('AC-17 creates names accepted by the E2E and identity fixtures and within PostgreSQL limits', () => {
    const now = new Date('2026-10-29T14:22:33.456Z');
    const e2e = provisionDatabaseName('e2e', now, '0a1b2c');
    const identity = provisionDatabaseName('identity', now, '0a1b2c');
    expect(e2e).toBe('daifuku_e2e_test_g202610291422330a1b2c');
    expect(identity).toBe('daifuku_e2e_test_enterprise_g202610291422330a1b2c');
    expect(E2E_DATABASE_NAME.test(e2e)).toBe(true);
    expect(IDENTITY_DATABASE_NAME.test(identity)).toBe(true);
    expect(E2E_DATABASE_NAME.test(identity)).toBe(false);
    expect(Math.max(e2e.length, identity.length)).toBeLessThanOrEqual(63);
    const targets = provisionTargets(fullEnv);
    if (!targets) throw new Error('expected provision targets');
    expect(databaseUrl(targets.app, e2e)).toBe(`postgres://daifuku_app:app@127.0.0.1:5432/${e2e}`);
  });
  it('AC-17 mirrors the database-name rules of the fixture sources it feeds', () => {
    const e2eFixture = readFileSync(join(ROOT, 'apps/api/src/db/e2e-fixture.ts'), 'utf8');
    const commerceFixture = readFileSync(join(ROOT, 'apps/api/test/commerce-e2e-fixture.ts'), 'utf8');
    const identityFixture = readFileSync(join(ROOT, 'apps/api/test/identity-e2e-database.ts'), 'utf8');
    const e2eBody = E2E_DATABASE_NAME.source.slice(1);
    const identityBody = IDENTITY_DATABASE_NAME.source.slice(1);
    expect(e2eFixture).toContain(`/^\\/${e2eBody}/`);
    expect(commerceFixture).toContain(`/^\\/${e2eBody}/`);
    expect(identityFixture).toContain(`/^\\/${identityBody}/`);
  });
  it('AC-17 never lets Playwright fall back to the caller environment or start an older compiled API', () => {
    const state = {
      provision: true,
      browserEnv: null,
      passed: [] as string[],
      planned: ['build:api', 'browser:prepare'],
    };
    expect(provisionGuard({ special: 'browser:prepare' }, state)).toMatch(/build:api did not pass/);
    expect(provisionGuard({ special: 'browser:prepare' }, { ...state, passed: ['build:api'] })).toBeNull();
    expect(provisionGuard({ special: 'browser' }, state)).toMatch(/fixture was not prepared/);
    expect(provisionGuard({ special: 'smoke' }, state)).toMatch(/fixture was not prepared/);
    expect(provisionGuard({ special: 'smoke' }, { ...state, browserEnv: { E2E_API_URL: 'http://x' } })).toBeNull();
    expect(provisionGuard({ special: 'browser' }, { ...state, provision: false })).toBeNull();
    expect(provisionGuard({ special: null }, state)).toBeNull();
  });
});

describe('AC-18 explicit DB-test variables', () => {
  it('AC-18 blocks DB suites without TEST_DATABASE_URL_OWNER/TEST_DATABASE_URL instead of using daifuku_test', () => {
    const steps = applyPreflight(plan('light', ['modules/banking/src/matching.ts']).steps, {
      env: {},
      options: options({ tier: 'light' }),
    });
    expect(find(steps, 'db').blocked).toContain(GUIDANCE.testDb);
    expect(find(steps, 'db').blocked).toMatch(/must both be set/);
    expect(GUIDANCE.testDb).toMatch(/never falls back to the default daifuku_test/);
    const allowed = applyPreflight(plan('light', ['modules/banking/src/matching.ts']).steps, {
      env: fullEnv,
      options: options({ tier: 'light' }),
    });
    expect(find(allowed, 'db').blocked).toBeNull();
    expect(find(allowed, 'db').note).toBe('recreates daifuku_test_x on 127.0.0.1:5432');
    // The guidance says what the DB suites do to the server: recreate the test database and keep template databases.
    expect(GUIDANCE.testDb).toMatch(/drop and recreate the test database .*<db>_tpl_\* schema template databases/);
  });
  it('AC-18 accepts only a loopback disposable test database with separate owner and daifuku_app roles', () => {
    const env = {
      TEST_DATABASE_URL_OWNER: fullEnv.TEST_DATABASE_URL_OWNER,
      TEST_DATABASE_URL: fullEnv.TEST_DATABASE_URL,
    };
    expect(testDatabaseProblems(env)).toEqual([]);
    for (const name of ['daifuku_test', 'daifuku_ci_test', 'daifuku_test_w1'])
      expect(
        testDatabaseProblems({
          TEST_DATABASE_URL_OWNER: `postgres://daifuku_owner:owner@localhost:5432/${name}`,
          TEST_DATABASE_URL: `postgres://daifuku_app:app@localhost:5432/${name}`,
        }),
        name,
      ).toEqual([]);
    const cases: [Record<string, string>, RegExp][] = [
      [{ TEST_DATABASE_URL_OWNER: 'postgres://daifuku_owner:owner@db.example.test:5432/daifuku_test_x' }, /loopback/],
      [{ TEST_DATABASE_URL: 'postgres://daifuku_app:app@127.0.0.1:5432/daifuku_test_y' }, /same database/],
      [
        {
          TEST_DATABASE_URL_OWNER: 'postgres://daifuku_owner:owner@127.0.0.1:5432/daifuku',
          TEST_DATABASE_URL: 'postgres://daifuku_app:app@127.0.0.1:5432/daifuku',
        },
        /not named daifuku_test/,
      ],
      [{ TEST_DATABASE_URL: 'postgres://daifuku_owner:owner@127.0.0.1:5432/daifuku_test_x' }, /different roles/],
      [{ TEST_DATABASE_URL: 'postgres://someone:app@127.0.0.1:5432/daifuku_test_x' }, /daifuku_app/],
      [{ TEST_DATABASE_URL: 'postgres://daifuku_app:app@127.0.0.1:5433/daifuku_test_x' }, /same server/],
    ];
    for (const [override, problem] of cases)
      expect(testDatabaseProblems({ ...env, ...override }).join('; ')).toMatch(problem);
    const prod = {
      ...env,
      TEST_DATABASE_URL_OWNER: 'postgres://o:o@127.0.0.1:5432/daifuku',
      TEST_DATABASE_URL: 'postgres://a:a@127.0.0.1:5432/daifuku',
    };
    expect(testDatabaseProblems({ ...prod, GATE_ALLOW_DB_URL: '1' })).toEqual([]);
    const blocked = applyPreflight(plan('light', ['modules/banking/src/matching.ts']).steps, {
      env: prod,
      options: options({ tier: 'light' }),
    });
    expect(find(blocked, 'db').blocked).toMatch(/Problems: .*not named daifuku_test/);
  });
  it('AC-18 passes GATE_IDENTITY_* (or provisioned URLs) to the identity step only and scrubs fixture environments', () => {
    const env = { ...fullEnv, PATH: '/usr/bin', E2E_INVOICE_DATE: '2026-10-29' };
    const identity = identityStepEnv(env);
    expect(identity).toMatchObject({
      TEST_DATABASE_URL_OWNER: fullEnv.GATE_IDENTITY_DATABASE_URL_OWNER,
      TEST_DATABASE_URL: fullEnv.GATE_IDENTITY_DATABASE_URL,
      E2E_IDENTITY_PREPARE: '1',
      PATH: '/usr/bin',
    });
    for (const name of [
      'GATE_IDENTITY_DATABASE_URL_OWNER',
      'GATE_IDENTITY_DATABASE_URL',
      'E2E_API_URL',
      'DATABASE_URL',
      'DATABASE_URL_OWNER',
    ])
      expect(identity, name).not.toHaveProperty(name);
    expect(identityStepEnv(env, { owner: 'postgres://o@127.0.0.1/i', app: 'postgres://a@127.0.0.1/i' })).toMatchObject({
      TEST_DATABASE_URL_OWNER: 'postgres://o@127.0.0.1/i',
      TEST_DATABASE_URL: 'postgres://a@127.0.0.1/i',
    });
    const fixture = browserFixtureEnv(env, {
      owner: 'postgres://o@127.0.0.1/f',
      app: 'postgres://a@127.0.0.1/f',
      date: '2026-10-30',
    });
    expect(fixture).toMatchObject({
      DATABASE_URL_OWNER: 'postgres://o@127.0.0.1/f',
      DATABASE_URL: 'postgres://a@127.0.0.1/f',
      E2E_PREPARE: '1',
      E2E_INVOICE_DATE: '2026-10-30',
      TZ: 'Asia/Tokyo',
      PATH: '/usr/bin',
    });
    for (const name of ['TEST_DATABASE_URL_OWNER', 'TEST_DATABASE_URL', 'GATE_IDENTITY_DATABASE_URL', 'E2E_API_URL'])
      expect(fixture, name).not.toHaveProperty(name);
    expect(scrubbedEnv(env, ['E2E_API_URL'])).toHaveProperty('E2E_API_URL', fullEnv.E2E_API_URL);
  });
});

describe('AC-7 report', () => {
  const run = plan('quick', ['modules/sales/src/index.ts', 'docs/x.md'], { deleted: ['modules/sales/src/gone.ts'] });
  const steps = run.steps.map((item) => ({
    ...item,
    result: item.skip?.result ?? 'passed',
    seconds: 1.25,
    selected: item.id === 'unit' ? { files: 3, total: 124 } : item.selected,
  }));
  const report = buildReport({
    tier: 'quick',
    options: options(),
    base,
    head: COMMIT,
    changes: run.changes,
    cls: run.cls,
    escalation: run.escalation,
    steps,
    startedAt: new Date('2026-10-29T00:00:00.000Z'),
    finishedAt: new Date('2026-10-29T00:00:42.000Z'),
    result: 'passed',
  });
  it('AC-7 records base, change count, tier, partial, escalation and per-step timing and selection', () => {
    expect(report).toMatchObject({
      schema: 1,
      tier: 'quick',
      result: 'passed',
      seconds: 42,
      head: COMMIT,
      base,
      partial: false,
    });
    expect(report.changed).toEqual({
      count: 3,
      deleted: 1,
      files: ['modules/sales/src/index.ts', 'docs/x.md', 'modules/sales/src/gone.ts (deleted)'],
      truncated: false,
    });
    expect(report.escalation.reasons.map((reason) => reason.rule)).toEqual(['deleted-source']);
    expect(report.steps.find((item) => item.id === 'unit')).toMatchObject({
      result: 'passed',
      seconds: 1.25,
      selected: { files: 3, total: 124 },
    });
    expect(report.skipped.map((item) => item.id)).toEqual(['deploy']);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
  it('AC-7 prints a table that matches the JSON report', () => {
    const table = formatTable(report);
    for (const item of report.steps)
      expect(table).toMatch(new RegExp(`^${item.id.replace(':', '\\:')}\\s+${item.result}`, 'm'));
    expect(table).toMatch(/3\/124 files/);
    expect(table).toContain(`base=origin/main@${base.commit?.slice(0, 7)} (merge-base)`);
    expect(table).toMatch(/escalation: includes changes that need full regression/);
    expect(table).toContain(
      'changed files (3):\n  modules/sales/src/index.ts\n  docs/x.md\n  modules/sales/src/gone.ts (deleted)\n',
    );
    expect(table).not.toMatch(/WARNING/);
  });
  it('AC-7 AC-13 lists changed paths on stdout, capped outside dry-runs', () => {
    const many = changesOf(Array.from({ length: CHANGED_FILES_IN_TABLE + 5 }, (_, index) => `docs/f${index}.md`));
    const input = {
      tier: 'quick' as const,
      options: options(),
      base,
      changes: many,
      cls: classifyChanges(many),
      escalation: detectEscalation(many),
      steps: [],
      startedAt: new Date(0),
      finishedAt: new Date(0),
      result: 'passed',
    };
    const table = formatTable(buildReport(input));
    expect(table).toContain(`  docs/f${CHANGED_FILES_IN_TABLE - 1}.md\n`);
    expect(table).not.toContain(`  docs/f${CHANGED_FILES_IN_TABLE}.md\n`);
    expect(table).toMatch(/\.\.\. 5 more \(full list in the JSON report/);
    const dry = formatTable(buildReport({ ...input, options: options({ dryRun: true }), result: 'dry-run' }));
    expect(dry).toContain(`  docs/f${CHANGED_FILES_IN_TABLE + 4}.md`);
    expect(dry).not.toMatch(/more \(full list/);
  });
  it('AC-7 names report files by UTC time and tier and truncates huge change lists', () => {
    expect(reportFileName('light', new Date('2026-10-29T14:22:33.456Z'))).toBe('20261029T142233Z-light.json');
    const many = changesOf(Array.from({ length: MAX_REPORTED_FILES + 5 }, (_, index) => `docs/f${index}.md`));
    const big = buildReport({
      tier: 'quick',
      options: options(),
      base,
      changes: many,
      cls: classifyChanges(many),
      escalation: detectEscalation(many),
      steps: [],
      startedAt: new Date(0),
      finishedAt: new Date(0),
      result: 'dry-run',
    });
    expect(big.changed).toMatchObject({ count: MAX_REPORTED_FILES + 5, truncated: true });
    expect(big.changed.files).toHaveLength(MAX_REPORTED_FILES);
  });
});

describe('AC-8 gate composition', () => {
  it('AC-8 keeps pnpm gate exactly as before and routes the tiers through scripts/gate.mjs', () => {
    expect(manifest.scripts.gate).toBe(
      'pnpm format:check && pnpm typecheck && pnpm lint && pnpm test && pnpm test:db && pnpm test:deploy && pnpm docs:check && pnpm verify:assurance',
    );
    expect(manifest.scripts['gate:quick']).toBe('node scripts/gate.mjs --tier quick');
    expect(manifest.scripts['gate:light']).toBe('node scripts/gate.mjs --tier light');
    expect(manifest.scripts['gate:full']).toBe('node scripts/gate.mjs --tier full');
  });
  it('AC-8 never adds vitest or Playwright filters that skip tests inside a selected file', () => {
    for (const tier of ['quick', 'light', 'full'] as const)
      for (const item of plan(tier, ['modules/sales/src/index.ts']).steps)
        expect(commandText(item.command)).not.toMatch(/--(testNamePattern|exclude|bail|shard)|-t |\.only|\.skip/);
  });
});

describe('AC-9 fail-fast and keep-going', () => {
  const steps = plan('light', ['modules/sales/src/index.ts']).steps.map((item) =>
    item.id === 'db' ? { ...item, selection: null, command: { program: 'pnpm' as const, args: ['test:db'] } } : item,
  );
  it('AC-9 stops after the first failure by default', async () => {
    const ran: string[] = [];
    const outcome = await runSteps(steps, {
      execute: async (item) => {
        ran.push(item.id);
        return { ok: item.id !== 'typecheck' };
      },
    });
    expect(ran).toEqual(['format', 'docs', 'assurance', 'typecheck']);
    expect(outcome.ok).toBe(false);
    expect(find(outcome.steps, 'lint')).toMatchObject({ result: 'not-run', reason: 'an earlier step failed' });
  });
  it('AC-9 --keep-going runs every remaining step and still fails', async () => {
    const ran: string[] = [];
    const outcome = await runSteps(steps, {
      keepGoing: true,
      execute: async (item) => {
        ran.push(item.id);
        return { ok: item.id !== 'typecheck' };
      },
    });
    expect(ran).toEqual([
      'format',
      'docs',
      'assurance',
      'typecheck',
      'typecheck:api',
      'typecheck:web',
      'lint',
      'unit',
      'db',
      'deploy',
    ]);
    expect(outcome.ok).toBe(false);
    expect(find(outcome.steps, 'deploy').result).toBe('passed');
  });
  it('AC-9 marks the rest not-run after an interruption', async () => {
    const outcome = await runSteps(steps, {
      keepGoing: true,
      execute: async (item) => ({ ok: item.id !== 'docs', interrupted: item.id === 'docs' }),
    });
    expect(outcome.interrupted).toBe(true);
    expect(find(outcome.steps, 'assurance')).toMatchObject({ result: 'not-run', reason: 'interrupted' });
  });
  it('AC-9 carries an interruption through a failed selection or fixture step even with --keep-going', async () => {
    let interrupted = false;
    const ran: string[] = [];
    const outcome = await runSteps(steps, {
      keepGoing: true,
      isInterrupted: () => interrupted,
      prepare: async (item) => {
        if (item.id === 'typecheck') {
          interrupted = true;
          throw new Error('test selection for unit failed');
        }
        return item;
      },
      execute: async (item) => {
        ran.push(item.id);
        return { ok: true };
      },
    });
    expect(ran).toEqual(['format', 'docs', 'assurance']);
    expect(outcome).toMatchObject({ ok: false, interrupted: true });
    expect(find(outcome.steps, 'typecheck')).toMatchObject({
      result: 'failed',
      reason: 'interrupted (test selection for unit failed)',
    });
    expect(find(outcome.steps, 'lint')).toMatchObject({ result: 'not-run', reason: 'interrupted' });
  });
});

describe('AC-10 empty selection', () => {
  it('AC-10 reports no-target and succeeds when no test file is related', async () => {
    const unit = find(plan('quick', ['docs/plain.md']).steps, 'unit');
    const resolved = applySelection(unit, { project: 'unit', total: 124, selected: [] });
    expect(resolved.skip).toEqual({ result: 'no-target', reason: 'no related test file' });
    const outcome = await runSteps([unit], { prepare: async () => resolved, execute: async () => ({ ok: false }) });
    expect(outcome.ok).toBe(true);
    expect(outcome.steps[0]).toMatchObject({ result: 'no-target', reason: 'no related test file' });
  });
});

describe('AC-11 smoke tests', () => {
  it('AC-11 e2e:smoke greps @smoke with the regular Playwright configuration', () => {
    expect(manifest.scripts['e2e:smoke']).toBe('pnpm --filter @daifuku/web exec playwright test --grep @smoke');
  });
  it('AC-11 tags six to eight representative browser tests', () => {
    const directory = join(ROOT, 'apps/web/e2e');
    const titles = readdirSync(directory)
      .filter((name) => name.endsWith('.spec.ts'))
      .flatMap((name) =>
        [...readFileSync(join(directory, name), 'utf8').matchAll(/^test\(\s*'([^']*@smoke[^']*)'/gm)].map(
          (match) => `${name}: ${match[1]}`,
        ),
      );
    expect(titles.length).toBeGreaterThanOrEqual(6);
    expect(titles.length).toBeLessThanOrEqual(8);
    expect(titles.every((title) => title.endsWith(' @smoke'))).toBe(true);
  });
  it('AC-11 light --with-smoke runs the smoke suite last, building and provisioning first with --provision', () => {
    expect(plan('light', [], { opts: { withSmoke: true } }).steps.at(-1)?.special).toBe('smoke');
    const provisioned = plan('light', [], { opts: { withSmoke: true, provision: true } }).steps.map((item) => item.id);
    expect(provisioned.slice(-3)).toEqual(['build:api', 'browser:prepare', 'smoke']);
    const blocked = applyPreflight(plan('light', [], { opts: { withSmoke: true } }).steps, {
      env: fullEnv,
      options: options({ tier: 'light', withSmoke: true }),
      reach: {},
    });
    expect(find(blocked, 'smoke').blocked).toContain(GUIDANCE.smoke);
  });
  it('AC-11 the smoke preflight needs only reachable E2E_API_URL and E2E_BASE_URL', () => {
    const env = { E2E_API_URL: 'http://localhost:3000', E2E_BASE_URL: 'http://localhost:5173' };
    expect(smokePrerequisites(env, { api: true, web: true })).toEqual([]);
    expect(smokePrerequisites({ E2E_API_URL: env.E2E_API_URL }, { api: true })).toEqual(['E2E_BASE_URL']);
    expect(smokePrerequisites(env, { api: false, web: true })).toEqual(['reachable http://localhost:3000/health']);
    const steps = plan('light', ['docs/x.md'], { opts: { withSmoke: true } }).steps;
    const checked = applyPreflight(steps, {
      env: {
        ...env,
        TEST_DATABASE_URL_OWNER: fullEnv.TEST_DATABASE_URL_OWNER,
        TEST_DATABASE_URL: fullEnv.TEST_DATABASE_URL,
      },
      options: options({ tier: 'light', withSmoke: true }),
      reach: { api: true, web: true },
    });
    expect(checked.filter((item) => item.blocked)).toEqual([]);
  });
});

describe('AC-12 CI quick job', () => {
  it('AC-12 adds a DB-free quick job with pinned actions and keeps the existing jobs', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const quick = /\n {2}quick:\n([\s\S]*?)\n {2}gate:\n/.exec(workflow)?.[1] ?? '';
    for (const command of [
      'pnpm install --frozen-lockfile',
      'pnpm format:check',
      'pnpm typecheck',
      'pnpm lint',
      'pnpm test',
    ])
      expect(quick).toContain(`- run: ${command}\n`);
    expect(quick).not.toMatch(/services:|postgres|DATABASE_URL/);
    expect(quick).toContain('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1');
    expect(quick).toContain('persist-credentials: false');
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
    for (const job of ['gate', 'e2e', 'identity', 'setup']) expect(workflow).toMatch(new RegExp(`\\n {2}${job}:\\n`));
    // The quick job pins exactly the same actions as the gate job, so a pin bump cannot miss one of them.
    const gate = /\n {2}gate:\n([\s\S]*?)\n {2}[\w-]+:\n/.exec(workflow)?.[1] ?? '';
    const pins = (block: string) =>
      Object.fromEntries([...block.matchAll(/uses: ([^@\s]+)@(\S+)/g)].map((match) => [match[1], match[2]]));
    expect(Object.keys(pins(quick))).toEqual(['actions/checkout', 'pnpm/action-setup', 'actions/setup-node']);
    for (const [action, sha] of Object.entries(pins(quick))) expect(pins(gate)[action], action).toBe(sha);
  });
});

describe('AC-13 CLI and dry-run', () => {
  it('AC-13 parses tiers, flags and Playwright arguments and rejects contradictory options', () => {
    expect(parseCli(['--tier', 'light', '--with-smoke', '--provision', '--', '--grep', '@smoke'])).toMatchObject({
      tier: 'light',
      withSmoke: true,
      provision: true,
      playwrightArgs: ['--grep', '@smoke'],
    });
    expect(parseCli(['--help'])).toEqual({ help: true });
    for (const argv of [
      [],
      ['--tier', 'medium'],
      ['--tier', 'quick', '--with-smoke'],
      ['--tier', 'light', '--without-browser'],
      ['--tier', 'full', '--provision', '--without-browser'],
      ['--tier', 'quick', '--provision'],
      ['--tier', 'quick', '--', '--grep', 'x'],
      ['--tier', 'quick', '--unknown'],
    ])
      expect(() => parseCli(argv)).toThrow(GateUsageError);
  });
  it('AC-13 dry-run prints the change set and plan and writes a report without running any step', () => {
    const dir = sandbox({ gate: manifest.scripts.gate ?? '' });
    try {
      writeFileSync(join(dir, 'notes file.md'), '# notes\n');
      const result = spawnSync(
        process.execPath,
        [join(dir, 'scripts/gate.mjs'), '--tier', 'full', '--dry-run', '--without-browser'],
        { cwd: dir, encoding: 'utf8', env: { ...process.env, GATE_BASE: 'HEAD' } },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/gate:full {2}result=dry-run/);
      expect(result.stdout).toContain('changed files (1):\n  notes file.md\n');
      expect(result.stdout).toMatch(/^format\s+planned/m);
      expect(result.stdout).toMatch(/report: \.runtime\/gate\/\S+-full\.json/);
      const report = sandboxReport(dir, 'full');
      expect(report).toMatchObject({ dryRun: true, partial: true, changed: { files: ['notes file.md'] } });
      expect(
        report?.steps.every((item) => ['planned', 'skipped', 'blocked'].includes(item.result) && item.seconds === 0),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('AC-15 quick refuses to report success when it has no base and no change to look at', () => {
    const dir = mkdtempSync(join(tmpdir(), 'daifuku-gate-unborn-'));
    try {
      mkdirSync(join(dir, 'scripts'));
      copyFileSync(join(ROOT, 'scripts/gate.mjs'), join(dir, 'scripts/gate.mjs'));
      writeFileSync(join(dir, 'package.json'), '{"name":"x","private":true,"scripts":{"gate":"pnpm a"}}\n');
      writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages: []\n');
      for (const args of [
        ['init', '-q', '-b', 'main'],
        ['add', '.'],
        ['-c', 'user.name=g', '-c', 'user.email=g@x.invalid', 'commit', '-q', '-m', 'one'],
      ])
        spawnSync('git', args, { cwd: dir });
      writeFileSync(join(dir, '.gitignore'), '*\n');
      const env = { ...process.env, GATE_BASE: '' };
      const result = spawnSync(process.execPath, [join(dir, 'scripts/gate.mjs'), '--tier', 'quick'], {
        cwd: dir,
        encoding: 'utf8',
        env,
      });
      expect(result.status, result.stdout + result.stderr).toBe(1);
      expect(result.stdout).toMatch(/result=base-unknown/);
      expect(result.stderr).toMatch(/WARNING: the base fell back to HEAD \(head\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('AC-9 interruption stops the whole process tree', () => {
  const slow = [
    "import { spawn } from 'node:child_process';",
    "import { writeFileSync } from 'node:fs';",
    "const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    "writeFileSync('pids.json', JSON.stringify({ child: process.pid, grandchild: grandchild.pid }));",
    'setInterval(() => {}, 1000);',
    '',
  ].join('\n');
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const waitFor = async (condition: () => boolean, ms: number) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (condition()) return true;
      await new Promise((done) => setTimeout(done, 100));
    }
    return condition();
  };
  const pnpmCommand = (args: string[]): [string, string[]] => {
    const cli = process.env.npm_execpath;
    if (cli && /pnpm/i.test(cli)) return /\.[cm]?js$/.test(cli) ? [process.execPath, [cli, ...args]] : [cli, args];
    return ['pnpm', args];
  };
  // A failing run must not leak the sandbox processes into later tests.
  const cleanup = (dir: string, extra: (number | undefined)[]) => {
    const file = join(dir, 'pids.json');
    const pids = existsSync(file)
      ? Object.values(JSON.parse(readFileSync(file, 'utf8')) as Record<string, number>)
      : [];
    for (const pid of [...pids, ...extra])
      if (pid && alive(pid))
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
    rmSync(dir, { recursive: true, force: true });
  };
  const scripts = {
    gate: 'pnpm slow',
    slow: 'node slow.mjs',
    'gate:full': 'node scripts/gate.mjs --tier full --without-browser',
  };
  it('AC-9 SIGTERM to the gate stops the running step, the pnpm it started and every descendant', async () => {
    const dir = sandbox(scripts, { 'slow.mjs': slow });
    let gate: ReturnType<typeof spawn> | undefined;
    try {
      const child = spawn(process.execPath, [join(dir, 'scripts/gate.mjs'), '--tier', 'full', '--without-browser'], {
        cwd: dir,
        stdio: 'ignore',
      });
      gate = child;
      const exited = new Promise<number | null>((done) => child.once('exit', (code) => done(code)));
      expect(await waitFor(() => existsSync(join(dir, 'pids.json')), 30_000)).toBe(true);
      const pids = JSON.parse(readFileSync(join(dir, 'pids.json'), 'utf8')) as { child: number; grandchild: number };
      child.kill('SIGTERM');
      const timeout = new Promise<string>((done) => setTimeout(() => done('still running after 20 s'), 20_000));
      expect(await Promise.race([exited, timeout])).toBe(143);
      expect(await waitFor(() => !alive(pids.child) && !alive(pids.grandchild), 5_000)).toBe(true);
      const report = sandboxReport(dir, 'full');
      expect(report?.result).toBe('interrupted');
      expect(report?.steps[0]).toMatchObject({ id: 'slow', result: 'failed' });
      expect(report?.steps.find((item) => item.id === 'typecheck:api')).toMatchObject({
        result: 'not-run',
        reason: 'interrupted',
      });
    } finally {
      cleanup(dir, [gate?.pid]);
    }
  }, 60_000);
  it('AC-9 SIGTERM to the outer pnpm of pnpm gate:full still stops the gate and its step processes', async () => {
    const dir = sandbox(scripts, { 'slow.mjs': slow });
    let outer: ReturnType<typeof spawn> | undefined;
    try {
      const [command, args] = pnpmCommand(['gate:full']);
      const child = spawn(command, args, { cwd: dir, stdio: 'ignore' });
      outer = child;
      expect(await waitFor(() => existsSync(join(dir, 'pids.json')), 30_000)).toBe(true);
      const pids = JSON.parse(readFileSync(join(dir, 'pids.json'), 'utf8')) as { child: number; grandchild: number };
      child.kill('SIGTERM');
      expect(await waitFor(() => !alive(pids.child) && !alive(pids.grandchild), 15_000)).toBe(true);
      expect(await waitFor(() => sandboxReport(dir, 'full') !== null, 15_000)).toBe(true);
      expect(sandboxReport(dir, 'full')?.result).toBe('interrupted');
    } finally {
      cleanup(dir, [outer?.pid]);
    }
  }, 60_000);
});

describe('AC-14 dependencies', () => {
  it('AC-14 uses only Node built-ins in gate.mjs and the existing vitest Node API in gate-select.mjs', () => {
    const imports = (file: string) =>
      [...readFileSync(join(ROOT, file), 'utf8').matchAll(/^import [\s\S]*? from '([^']+)';$/gm)].map(
        (match) => match[1],
      );
    expect(imports('scripts/gate.mjs').every((name) => name?.startsWith('node:'))).toBe(true);
    expect(imports('scripts/gate-select.mjs').filter((name) => !name?.startsWith('node:'))).toEqual([
      'vitest/node',
      './gate.mjs',
    ]);
  });
});

describe('selection rules beyond the module graph', () => {
  const specs = [
    'modules/sales/test/recalculate.test.ts',
    'modules/tax/test/compute.test.ts',
    'apps/edge/test/model-traces.test.ts',
    'apps/api/test/identity-runner.test.ts',
  ];
  const texts: Record<string, string> = {
    'modules/sales/test/recalculate.test.ts': "readFileSync(new URL('./golden/invoice-posting.json', import.meta.url))",
    'modules/tax/test/compute.test.ts': "readFileSync(new URL('./golden/invoice-rounding.json', import.meta.url))",
    'apps/edge/test/model-traces.test.ts':
      "readFile(new URL('../../../verification/edge/traces.json', import.meta.url))",
    'apps/api/test/identity-runner.test.ts': "new URL('../../../scripts/test-identity-e2e.mjs', import.meta.url)",
  };
  it('AC-1 AC-3 selects tests that read or execute a changed non-module file by name', () => {
    const triggers = referenceTriggers([
      'verification/edge/traces.json',
      'scripts/test-identity-e2e.mjs',
      'modules/sales/src/index.ts',
      'package.json',
    ]);
    expect(triggers).toEqual(['verification/edge/traces.json', 'scripts/test-identity-e2e.mjs']);
    expect(selectByReference(triggers, specs, (file) => texts[file] ?? '')).toEqual([
      'apps/edge/test/model-traces.test.ts',
      'apps/api/test/identity-runner.test.ts',
    ]);
  });
  it('AC-1 AC-3 selects every spec of a test directory whose data files changed', () => {
    expect(
      selectByTestDirectory(['modules/sales/test/golden/invoice-posting.json', 'modules/sales/test/fixture.ts'], specs),
    ).toEqual(['modules/sales/test/recalculate.test.ts']);
  });
  it('AC-1 AC-3 lists related files through vitest without running tests', () => {
    const dir = mkdtempSync(join(tmpdir(), 'daifuku-gate-select-'));
    try {
      const output = join(dir, 'selection.json');
      const input = {
        project: 'unit',
        sources: ['scripts/gate.mjs'],
        triggers: ['modules/sales/test/golden/invoice-posting.json'],
        extra: [],
        output,
      };
      const result = spawnSync(process.execPath, [join(ROOT, 'scripts/gate-select.mjs')], {
        cwd: ROOT,
        input: JSON.stringify(input),
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      const selection = JSON.parse(readFileSync(output, 'utf8')) as {
        total: number;
        selected: { file: string; via: string; reasons?: string[] }[];
      };
      expect(selection.total).toBeGreaterThan(100);
      // `via` is the first rule; `reasons` lists every rule when more than one selected the file (db-test-startup AC-8).
      expect(selection.selected).toContainEqual({
        file: 'scripts/test/gate.test.ts',
        via: 'graph',
        reasons: ['graph', 'reference'],
      });
      expect(selection.selected).toContainEqual({
        file: 'modules/sales/test/recalculate.test.ts',
        via: 'directory',
        reasons: ['directory', 'reference'],
      });
      expect(selection.selected.some((entry) => entry.file.endsWith('.db.test.ts'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
  it('AC-1 AC-3 selects tests that run code of their own scope in a child process', () => {
    const spawning = ['apps/edge/test/bundle.test.ts', 'apps/mcp/test/stdio.db.test.ts', 'scripts/test/gate.test.ts'];
    const real = loadWorkspacePackages(ROOT);
    expect(spawnsProcesses("import { execFile, spawn } from 'node:child_process';")).toBe(true);
    expect(spawnsProcesses("import { readFile } from 'node:fs';")).toBe(false);
    expect(scopeOf('apps/edge/test/bundle.test.ts', real)).toBe('apps/edge');
    expect(scopeOf('scripts/test/gate.test.ts', real)).toBe('scripts');
    expect(selectBySubprocessScope(['apps/edge/scripts/build.mjs'], spawning, real)).toEqual([
      'apps/edge/test/bundle.test.ts',
    ]);
    expect(selectBySubprocessScope(['apps/mcp/src/main.ts', 'scripts/gate.mjs'], spawning, real)).toEqual([
      'apps/mcp/test/stdio.db.test.ts',
      'scripts/test/gate.test.ts',
    ]);
    expect(selectBySubprocessScope(['modules/sales/src/index.ts'], spawning, real)).toEqual([]);
  });
  it('AC-1 AC-3 finds subprocess entry files named in a test, inside its scope only', () => {
    const exists = (path: string) => existsSync(join(ROOT, path));
    const entries = (spec: string) =>
      subprocessEntries(
        spec,
        readFileSync(join(ROOT, spec), 'utf8'),
        scopeOf(spec, loadWorkspacePackages(ROOT)),
        exists,
      );
    expect(entries('apps/mcp/test/stdio.db.test.ts')).toContain('apps/mcp/test/fixtures/stdio-entry.ts');
    expect(entries('apps/runtime/test/runtime.test.ts')).toContain('apps/runtime/test/fixtures/catalog.ts');
    expect(entries('apps/edge/test/bundle.test.ts')).toContain('apps/edge/scripts/build.mjs');
    const text = "spawn('x', [new URL('../../../scripts/test-identity-e2e.mjs', import.meta.url), './dist/a.mjs'])";
    expect(subprocessEntries('apps/api/test/identity-runner.test.ts', text, 'apps/api', () => true)).toEqual([]);
  });
  it('AC-3 selects the suites a DB setup file prepares, parsed from the setup file itself', () => {
    const setup = readFileSync(join(ROOT, 'apps/api/test/payroll-provider-setup.ts'), 'utf8');
    const specs = [
      'modules/workforce/test/fiscal.db.test.ts',
      'modules/workforce/test/fiscal-rule-integrity.db.test.ts',
      'modules/workforce/test/workforce.db.test.ts',
    ];
    expect(setupFileTargets(setup, specs)).toEqual(specs.slice(0, 2));
    for (const file of specs.slice(0, 2)) expect(existsSync(join(ROOT, file)), file).toBe(true);
    expect(setup).toContain("import('@daifuku/l10n-jp')");
    expect(setupFileTargets("import './register.ts';", specs)).toEqual(specs);
  });
  it('AC-3 selects setup-prepared and subprocess DB suites through vitest and rejects unknown always-run suites', () => {
    const dir = mkdtempSync(join(tmpdir(), 'daifuku-gate-select-db-'));
    try {
      const run = (input: Record<string, unknown>) => {
        const file = join(dir, 'input.json');
        writeFileSync(file, JSON.stringify({ project: 'db', triggers: [], ...input, output: join(dir, 'out.json') }));
        return spawnSync(process.execPath, [join(ROOT, 'scripts/gate-select.mjs'), file], {
          cwd: ROOT,
          encoding: 'utf8',
        });
      };
      const sources = ['l10n/jp/src/payroll/provider.ts', 'apps/mcp/src/main.ts'];
      const result = run({ sources, extra: [...ALWAYS_DB_SUITES] });
      expect(result.status, result.stderr).toBe(0);
      const selection = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8')) as {
        selected: { file: string; via: string }[];
      };
      expect(selection.selected).toContainEqual({ file: 'modules/workforce/test/fiscal.db.test.ts', via: 'setup' });
      expect(selection.selected).toContainEqual({
        file: 'modules/workforce/test/fiscal-rule-integrity.db.test.ts',
        via: 'setup',
      });
      expect(selection.selected).toContainEqual({ file: 'apps/mcp/test/stdio.db.test.ts', via: 'subprocess' });
      expect(selection.selected).toContainEqual({ file: ALWAYS_DB_SUITES[0], via: 'always' });
      const stale = run({ sources: [], extra: ['kernel/test/renamed-away.db.test.ts'] });
      expect(stale.status).not.toBe(0);
      expect(stale.stderr).toMatch(/always-run suites are not db tests: kernel\/test\/renamed-away\.db\.test\.ts/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
  it('AC-1 quotes display arguments with spaces', () => {
    expect(commandText({ program: 'pnpm', args: ['exec', 'prettier', '--check', './new dir/a b.ts'] })).toBe(
      "pnpm exec prettier --check './new dir/a b.ts'",
    );
  });
});

// ---- docs/specs/light-tier-speed.md: light runs its static lane and DB lane side by side, DB suites over shards ----

const parallel = (paths: readonly string[], extra: { deleted?: string[]; opts?: Partial<Options> } = {}) =>
  plan('light', paths, { ...extra, opts: { parallel: true, dbShards: 2, ...extra.opts } });
const deferred = () => {
  let resolve: (value: { ok: boolean }) => void = () => undefined;
  const promise = new Promise<{ ok: boolean }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise((done) => setTimeout(done, 0));

describe('light-tier-speed AC-1 static and DB lanes side by side', () => {
  it('AC-1 puts every static step in the static lane in plan order and the DB step in its own lane', () => {
    const { steps } = parallel(['modules/sales/src/settings.ts']);
    expect(steps.map((item) => [item.id, item.lane])).toEqual([
      ['format', 'static'],
      ['docs', 'static'],
      ['assurance', 'static'],
      ['typecheck', 'static'],
      ['typecheck:api', 'static'],
      ['typecheck:web', 'static'],
      ['lint', 'static'],
      ['unit', 'static'],
      ['db', 'db'],
      ['deploy', 'static'],
    ]);
    const phases = planPhases(steps);
    expect(phases).toHaveLength(1);
    expect(phases[0]?.map((lane) => lane.map((entry) => entry.item.id))).toEqual([
      ['format', 'docs', 'assurance', 'typecheck', 'typecheck:api', 'typecheck:web', 'lint', 'unit', 'deploy'],
      ['db'],
    ]);
  });
  it('AC-1 keeps the serial plan without lanes and runs the smoke steps after both lanes', () => {
    expect(plan('light', ['modules/sales/src/settings.ts']).steps.every((item) => item.lane === undefined)).toBe(true);
    const { steps } = parallel(['docs/x.md'], { opts: { withSmoke: true, provision: true } });
    expect(steps.slice(-3).map((item) => [item.id, item.lane])).toEqual([
      ['build:api', undefined],
      ['browser:prepare', undefined],
      ['smoke', undefined],
    ]);
    const phases = planPhases(steps);
    expect(phases.map((phase) => phase.length)).toEqual([2, 1, 1, 1]);
    expect(planPhases(plan('full', ['docs/x.md']).steps).every((phase) => phase.length === 1)).toBe(true);
  });
  it('AC-1 starts the DB lane while the static lane runs and reports results in plan order', async () => {
    const { steps } = parallel(['modules/sales/src/settings.ts']);
    const runnable = steps.map((item) => (item.id === 'db' ? { ...item, selection: null } : item));
    const started: string[] = [];
    const format = deferred();
    const db = deferred();
    const outcome = runSteps(runnable, {
      execute: async (item) => {
        started.push(item.id);
        if (item.id === 'format') return format.promise;
        if (item.id === 'db') return db.promise;
        return { ok: true };
      },
    });
    await tick();
    expect(started).toEqual(['format', 'db']);
    format.resolve({ ok: true });
    for (let index = 0; index < 20; index++) await tick();
    expect(started).toContain('deploy');
    db.resolve({ ok: true });
    const result = await outcome;
    expect(result.ok).toBe(true);
    expect(result.steps.map((item) => item.id)).toEqual(runnable.map((item) => item.id));
    expect(result.steps.every((item) => item.result === 'passed')).toBe(true);
    expect(find(result.steps, 'db').offset).toBe(0);
  });
  it('AC-1 waits for both lanes before a step without a lane starts', async () => {
    const order: string[] = [];
    const slow = deferred();
    const laned = parallel(['docs/x.md']).steps;
    const steps = [
      find(laned, 'format'),
      { ...find(laned, 'db'), selection: null },
      { ...find(laned, 'deploy'), lane: undefined },
    ];
    const outcome = runSteps(steps, {
      execute: async (item) => {
        order.push(`start ${item.id}`);
        await (item.id === 'db' ? slow.promise : tick());
        order.push(`end ${item.id}`);
        return { ok: true };
      },
    });
    await tick();
    slow.resolve({ ok: true });
    await outcome;
    // Both lanes start before either ends; the step without a lane starts only after both ended.
    expect(order.slice(0, 2)).toEqual(['start format', 'start db']);
    expect(order.slice(2, 4).sort()).toEqual(['end db', 'end format']);
    expect(order.slice(4)).toEqual(['start deploy', 'end deploy']);
  });
});

describe('light-tier-speed AC-2 DB suites split over shards', () => {
  const files = ['a.db.test.ts', 'b.db.test.ts', 'c.db.test.ts', 'd.db.test.ts', 'e.db.test.ts'];
  it('AC-2 runs every selected file exactly once, longest first onto the least loaded shard', () => {
    const durations = new Map([
      ['a.db.test.ts', 50],
      ['b.db.test.ts', 30],
      ['c.db.test.ts', 25],
      ['d.db.test.ts', 10],
      ['e.db.test.ts', 4],
    ]);
    // 50 -> shard 1; 30 -> shard 2; 25 -> shard 2 (55); 10 -> shard 1 (60); 4 -> shard 2 (59).
    expect(partitionShards(files, durations, 2)).toEqual([
      { files: ['a.db.test.ts', 'd.db.test.ts'], estimate: 60 },
      { files: ['b.db.test.ts', 'c.db.test.ts', 'e.db.test.ts'], estimate: 59 },
    ]);
    for (const count of [1, 2, 3, MAX_DB_SHARDS]) {
      const split = partitionShards(files, durations, count).flatMap((shard) => shard.files);
      expect(split.sort()).toEqual([...files].sort());
    }
    expect(partitionShards(files, durations, 2)).toEqual(partitionShards([...files].reverse(), durations, 2));
  });
  it('AC-2 uses fewer shards than asked for when fewer files are selected and estimates unknown suites', () => {
    expect(partitionShards(['only.db.test.ts'], new Map(), 4)).toEqual([
      { files: ['only.db.test.ts'], estimate: DEFAULT_SUITE_SECONDS },
    ]);
    const median = partitionShards(
      ['x', 'y', 'z'],
      new Map([
        ['x', 2],
        ['y', 40],
      ]),
      3,
    );
    expect(median.find((shard) => shard.files.includes('z'))?.estimate).toBe(40);
  });
  it('AC-2 reads suite durations from the vitest results cache of the db project only', () => {
    const cache = JSON.stringify({
      version: '5.0.0',
      results: [
        ['db:modules/sales/test/sales.db.test.ts', { duration: 7700, failed: false }],
        ['unit:modules/sales/test/recalculate.test.ts', { duration: 300, failed: false }],
        ['db:broken', { duration: 'x' }],
      ],
    });
    expect([...parseSuiteDurations([cache, '{not json'])]).toEqual([['modules/sales/test/sales.db.test.ts', 7.7]]);
  });
  it('AC-2 assigns shard 1 to the configured database and shard k to <db>_shard_k', () => {
    const step = { selectedFiles: files, shards: 2 };
    const { shards } = shardDatabases(fullEnv, 2);
    const planned = planShards(step, new Map(), shards);
    expect(planned.map((shard) => [shard.index, shard.database, shard.files.length])).toEqual([
      [1, 'daifuku_test_x', 3],
      [2, 'daifuku_test_x_shard_2', 2],
    ]);
    expect(planned[1]?.ownerUrl).toBe('postgres://daifuku_owner:owner@127.0.0.1:5432/daifuku_test_x_shard_2');
    expect(planned[1]?.appUrl).toBe('postgres://daifuku_app:app@127.0.0.1:5432/daifuku_test_x_shard_2');
    expect(planShards(step, new Map(), shards.slice(0, 1)).map((shard) => shard.files.length)).toEqual([5]);
  });
  it('AC-2 AC-8 lists every DB suite for an escalated sharded step and keeps pnpm test:db with one shard', () => {
    const sharded = find(parallel(['kernel/src/decimal.ts']).steps, 'db');
    expect(sharded.command).toBeNull();
    expect(sharded.shards).toBe(2);
    expect(sharded.selection).toMatchObject({ project: 'db', all: true });
    const single = find(parallel(['kernel/src/decimal.ts'], { opts: { dbShards: 1 } }).steps, 'db');
    expect(commandText(single.command)).toBe('pnpm test:db');
    expect(single.shards).toBeUndefined();
    const related = find(parallel(['modules/sales/src/settings.ts']).steps, 'db');
    expect(related.selection).toMatchObject({ project: 'db', deferSchemaSuites: true, extra: [...ALWAYS_DB_SUITES] });
    expect(related.selection?.all).toBeUndefined();
  });
  it('AC-2 AC-8 lists through vitest exactly the files vitest run --project db runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'daifuku-gate-select-all-'));
    try {
      const file = join(dir, 'input.json');
      const output = join(dir, 'out.json');
      const input = { project: 'db', all: true, sources: [], triggers: [], extra: [...ALWAYS_DB_SUITES], output };
      writeFileSync(file, JSON.stringify(input));
      const result = spawnSync(process.execPath, [join(ROOT, 'scripts/gate-select.mjs'), file], {
        cwd: ROOT,
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      const selection = JSON.parse(readFileSync(output, 'utf8')) as {
        total: number;
        selected: { file: string; via: string }[];
      };
      const listed = spawnSync(
        process.execPath,
        [join(ROOT, 'node_modules/vitest/vitest.mjs'), 'list', '--project', 'db', '--filesOnly', '--json'],
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      );
      expect(listed.status, listed.stderr).toBe(0);
      const expected = (JSON.parse(listed.stdout) as { file: string }[])
        .map((entry) => entry.file.slice(ROOT.length + 1))
        .sort();
      expect(selection.selected.map((entry) => entry.file)).toEqual(expected);
      expect(selection.total).toBe(expected.length);
      const always = selection.selected.filter((entry) => entry.via === 'always').map((entry) => entry.file);
      expect(always.sort()).toEqual([...ALWAYS_DB_SUITES].sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('light-tier-speed AC-3 shard databases', () => {
  it('AC-3 derives shard names that no checkout can use as its own test database', () => {
    expect(shardDatabaseName('daifuku_test_w9', 1)).toBe('daifuku_test_w9');
    expect(shardDatabaseName('daifuku_test_w9', 2)).toBe('daifuku_test_w9_shard_2');
    for (const name of ['daifuku_test', 'daifuku_ci_test', 'daifuku_test_w9']) {
      expect(TEST_DATABASE_NAME.test(name)).toBe(true);
      for (let index = 2; index <= MAX_DB_SHARDS; index++) {
        const shard = shardDatabaseName(name, index);
        expect(TEST_DATABASE_NAME.test(shard), shard).toBe(false);
        expect(SHARD_DATABASE_NAME.test(shard), shard).toBe(true);
      }
    }
    expect(SHARD_DATABASE_NAME.test('daifuku_test_w9')).toBe(false);
    expect(SHARD_DATABASE_NAME.test('daifuku_test_w9_shard_9')).toBe(false);
    expect(SHARD_DATABASE_NAME.test('production_shard_2')).toBe(false);
  });
  it('AC-3 keeps one shard for a database outside the test naming rule or too long for template names', () => {
    const allowed = {
      ...fullEnv,
      GATE_ALLOW_DB_URL: '1',
      TEST_DATABASE_URL_OWNER: 'postgres://o:o@127.0.0.1:5432/scratch_db',
      TEST_DATABASE_URL: 'postgres://daifuku_app:a@127.0.0.1:5432/scratch_db',
    };
    const other = shardDatabases(allowed, 2);
    expect(other.shards.map((shard) => shard.database)).toEqual(['scratch_db']);
    expect(other.reason).toMatch(/derived only from daifuku_test/);
    const longName = `daifuku_test_${'x'.repeat(SHARD_NAME_LIMIT)}`.slice(0, SHARD_NAME_LIMIT - 2);
    const long = shardDatabases(
      {
        TEST_DATABASE_URL_OWNER: `postgres://o:o@127.0.0.1:5432/${longName}`,
        TEST_DATABASE_URL: `postgres://daifuku_app:a@127.0.0.1:5432/${longName}`,
      },
      2,
    );
    expect(long.shards).toHaveLength(1);
    expect(long.reason).toMatch(/no room for schema template names/);
    expect(shardDatabases(fullEnv, 3).shards.map((shard) => shard.database)).toEqual([
      'daifuku_test_x',
      'daifuku_test_x_shard_2',
      'daifuku_test_x_shard_3',
    ]);
  });
  it('AC-3 AC-7 mirrors the shard infix of the kernel template cleanup', () => {
    const kernel = readFileSync(join(ROOT, 'kernel/src/test-database.ts'), 'utf8');
    expect(kernel).toContain(`export const SHARD_INFIX = '${SHARD_INFIX}';`);
    expect(SHARD_NAME_LIMIT).toBe(63 - '_tpl_'.length - 16);
  });
});

describe('light-tier-speed AC-4 concurrency options', () => {
  it('AC-4 defaults to lanes and two DB shards on four or more CPUs, one shard below', () => {
    expect(defaultDbShards(4)).toBe(2);
    expect(defaultDbShards(16)).toBe(2);
    expect(defaultDbShards(2)).toBe(1);
    expect(resolveConcurrency({ tier: 'light' }, {}, 4)).toMatchObject({ parallel: true, dbShards: 2 });
    expect(resolveConcurrency({ tier: 'light' }, {}, 2)).toMatchObject({ parallel: true, dbShards: 1 });
  });
  it('AC-4 --serial and GATE_PARALLEL=0 restore one step at a time with one DB process', () => {
    expect(resolveConcurrency({ tier: 'light', serial: true }, {}, 8)).toMatchObject({ parallel: false, dbShards: 1 });
    expect(resolveConcurrency({ tier: 'light' }, { GATE_PARALLEL: '0' }, 8)).toMatchObject({
      parallel: false,
      dbShards: 1,
    });
    expect(resolveConcurrency({ tier: 'light' }, { GATE_PARALLEL: '1' }, 8).parallel).toBe(true);
  });
  it('AC-4 takes --db-shards over GATE_DB_SHARDS and rejects values outside 1..8', () => {
    expect(resolveConcurrency({ tier: 'light', dbShards: '3' }, { GATE_DB_SHARDS: '1' }, 4).dbShards).toBe(3);
    expect(resolveConcurrency({ tier: 'light' }, { GATE_DB_SHARDS: '1' }, 4).dbShards).toBe(1);
    for (const value of ['0', '9', 'two', '1.5', '-1'])
      expect(() => resolveConcurrency({ tier: 'light', dbShards: value }, {}, 4)).toThrow(GateUsageError);
    expect(() => resolveConcurrency({ tier: 'light' }, { GATE_DB_SHARDS: '12' }, 4)).toThrow(GateUsageError);
    expect(() => resolveConcurrency({ tier: 'light' }, { GATE_PARALLEL: 'yes' }, 4)).toThrow(GateUsageError);
    expect(() => resolveConcurrency({ tier: 'light', serial: true, dbShards: '2' }, {}, 4)).toThrow(GateUsageError);
  });
  it('AC-4 AC-8 leaves quick and full serial with one DB process and limits the options to light', () => {
    for (const tier of ['quick', 'full'] as const)
      expect(resolveConcurrency({ tier }, { GATE_DB_SHARDS: '4' }, 16)).toEqual({
        parallel: false,
        dbShards: 1,
        notes: [],
      });
    expect(parseCli(['--tier', 'light', '--db-shards', '3'])).toMatchObject({ dbShardsOption: '3', serial: false });
    expect(parseCli(['--tier', 'light', '--serial'])).toMatchObject({ serial: true });
    for (const argv of [
      ['--tier', 'full', '--serial'],
      ['--tier', 'quick', '--db-shards', '2'],
      ['--tier', 'light', '--serial', '--db-shards', '2'],
      ['--tier', 'light', '--db-shards', '0'],
    ])
      expect(() => parseCli(argv)).toThrow(GateUsageError);
  });
});

describe('light-tier-speed AC-5 fail-fast across lanes', () => {
  const laned = parallel(['modules/sales/src/settings.ts']).steps.map((item) =>
    item.id === 'db' ? { ...item, selection: null, command: { program: 'pnpm' as const, args: ['test:db'] } } : item,
  );
  it('AC-5 stops the steps still running in other lanes when a step fails and starts no further step', async () => {
    const db = deferred();
    const cancelled: string[] = [];
    const ran: string[] = [];
    const outcome = await runSteps(laned, {
      cancel: (failedId) => {
        cancelled.push(failedId);
        db.resolve({ ok: false });
      },
      execute: async (item) => {
        ran.push(item.id);
        if (item.id === 'db') return db.promise;
        return { ok: item.id !== 'typecheck' };
      },
    });
    expect(cancelled).toEqual(['typecheck']);
    expect(ran).toEqual(['format', 'db', 'docs', 'assurance', 'typecheck']);
    expect(outcome.ok).toBe(false);
    expect(find(outcome.steps, 'typecheck').result).toBe('failed');
    expect(find(outcome.steps, 'db')).toMatchObject({ result: 'cancelled', reason: 'stopped after typecheck failed' });
    expect(find(outcome.steps, 'lint')).toMatchObject({ result: 'not-run', reason: 'an earlier step failed' });
  });
  it('AC-5 keeps a step that passed although a cancellation raced with its end', async () => {
    const db = deferred();
    const outcome = await runSteps(laned, {
      cancel: () => db.resolve({ ok: true }),
      execute: async (item) => (item.id === 'db' ? db.promise : { ok: item.id !== 'format' }),
    });
    expect(find(outcome.steps, 'db').result).toBe('passed');
    expect(find(outcome.steps, 'format').result).toBe('failed');
  });
  it('AC-5 --keep-going runs both lanes to the end without cancelling', async () => {
    const cancelled: string[] = [];
    const outcome = await runSteps(laned, {
      keepGoing: true,
      cancel: (failedId) => cancelled.push(failedId),
      execute: async (item) => ({ ok: item.id !== 'db' }),
    });
    expect(cancelled).toEqual([]);
    expect(outcome.ok).toBe(false);
    expect(find(outcome.steps, 'deploy').result).toBe('passed');
    expect(find(outcome.steps, 'db').result).toBe('failed');
  });
  it('AC-5 marks every running lane failed and the rest not-run after an interruption', async () => {
    let interrupted = false;
    const db = deferred();
    const outcome = await runSteps(laned, {
      isInterrupted: () => interrupted,
      execute: async (item) => {
        if (item.id === 'db') return db.promise;
        if (item.id === 'docs') {
          interrupted = true;
          db.resolve({ ok: false });
          return { ok: false, interrupted: true };
        }
        return { ok: true };
      },
    });
    expect(outcome).toMatchObject({ ok: false, interrupted: true });
    expect(find(outcome.steps, 'docs')).toMatchObject({ result: 'failed', reason: 'interrupted' });
    expect(find(outcome.steps, 'db')).toMatchObject({ result: 'failed', reason: 'interrupted' });
    expect(find(outcome.steps, 'assurance')).toMatchObject({ result: 'not-run', reason: 'interrupted' });
  });
});

describe('light-tier-speed AC-6 report', () => {
  const run = parallel(['modules/sales/src/settings.ts']);
  const shard = (index: number, database: string, paths: string[], seconds: number, result: string) => ({
    index,
    database,
    files: paths.length,
    paths,
    estimate: index === 1 ? 120 : 110,
    seconds,
    result,
    reason: result === 'failed' ? 'exit 1' : null,
    log: `.runtime/gate/r/db-${index}.log`,
  });
  const steps = run.steps.map((item) =>
    item.id === 'db'
      ? {
          ...item,
          result: 'failed',
          seconds: 200,
          offset: 0,
          selected: { files: 3, total: 118, via: { graph: 3 } },
          reason: 'shard 2 (daifuku_test_x_shard_2) exit 1',
          shardResults: [
            shard(1, 'daifuku_test_x', ['a.db.test.ts', 'b.db.test.ts'], 150.5, 'passed'),
            shard(2, 'daifuku_test_x_shard_2', ['c.db.test.ts'], 200, 'failed'),
          ],
        }
      : { ...item, result: 'passed', seconds: 10, offset: 1, log: `.runtime/gate/r/${item.id}.log` },
  );
  const input = {
    tier: 'light' as const,
    options: options({ tier: 'light' }),
    base,
    changes: run.changes,
    cls: run.cls,
    escalation: run.escalation,
    startedAt: new Date(0),
    finishedAt: new Date(210_000),
  };
  const report = buildReport({
    ...input,
    steps,
    result: 'failed',
    concurrency: { parallel: true, dbShards: 2, notes: ['2 DB shards by default on 4 CPUs'] },
  });
  it('AC-6 records lanes, offsets, logs, shards and the concurrency in the JSON report', () => {
    expect(report.concurrency).toEqual({ parallel: true, dbShards: 2, notes: ['2 DB shards by default on 4 CPUs'] });
    expect(report.steps.map((item) => item.id)).toEqual(run.steps.map((item) => item.id));
    expect(report.steps.find((item) => item.id === 'unit')).toMatchObject({
      lane: 'static',
      offset: 1,
      log: '.runtime/gate/r/unit.log',
    });
    const db = report.steps.find((item) => item.id === 'db');
    expect(db).toMatchObject({
      lane: 'db',
      seconds: 200,
      shards: [
        { index: 1, files: 2 },
        { index: 2, result: 'failed' },
      ],
    });
    expect(db?.shards?.flatMap((entry) => entry.paths)).toEqual(['a.db.test.ts', 'b.db.test.ts', 'c.db.test.ts']);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
  it('AC-6 prints a row per step, a row per shard and the lane totals', () => {
    const table = formatTable(report);
    for (const item of report.steps)
      expect(table).toMatch(new RegExp(`^${item.id.replace(':', '\\:')}\\s+${item.result}`, 'm'));
    expect(table).toMatch(/^ {2}db\[1\/2\]\s+passed\s+150\.5\s+2 files\s+daifuku_test_x, estimated 120s$/m);
    expect(table).toMatch(/^ {2}db\[2\/2\]\s+failed\s+200\.0\s+1 files\s+daifuku_test_x_shard_2/m);
    expect(table).toMatch(/^concurrency: lanes side by side \(static 90\.0s, db 200\.0s\); DB shards up to 2/m);
    expect(formatTable(buildReport({ ...input, steps: [], result: 'passed' }))).not.toMatch(/concurrency:/);
  });
  it('AC-6 counts a cancelled step as stopped in the report', () => {
    const cancelled = buildReport({
      ...input,
      steps: [{ ...find(run.steps, 'db'), result: 'cancelled', seconds: 12, reason: 'stopped after format failed' }],
      result: 'failed',
    });
    expect(cancelled.skipped).toEqual([{ id: 'db', result: 'cancelled', reason: 'stopped after format failed' }]);
    expect(formatTable(cancelled)).toMatch(/^db\s+cancelled\s+12\.0\s+.*stopped after format failed/m);
  });
  it('AC-6 picks vitest summary lines out of a step log', () => {
    const escape = String.fromCharCode(27);
    const log = [
      ' ✓ kernel/test/foundation.db.test.ts (12 tests) 1200ms',
      '',
      ` Test Files  ${escape}[32m30 passed${escape}[39m (30)`,
      '      Tests  180 passed (180)',
      '   Start at  05:00:00',
      '   Duration  120.00s',
    ].join('\n');
    expect(testSummary(log)).toBe('Test Files  30 passed (30) | Tests  180 passed (180)');
    expect(testSummary('Checking formatting...\nAll matched files use Prettier code style!')).toBe('');
  });
});

describe('light-tier-speed AC-5 AC-6 parallel light runs as processes', () => {
  // Every step is a sandbox script; the kernel change escalates the DB step to `pnpm test:db` with one shard, so the
  // run needs neither vitest nor a database.
  const env = {
    ...process.env,
    GATE_BASE: 'HEAD',
    GATE_DB_SHARDS: '1',
    GATE_PARALLEL: '',
    TEST_DATABASE_URL_OWNER: fullEnv.TEST_DATABASE_URL_OWNER,
    TEST_DATABASE_URL: fullEnv.TEST_DATABASE_URL,
  };
  const ok = 'node -e "console.log(\'Test Files  1 passed (1)\')"';
  const scripts = (overrides: Record<string, string> = {}) => ({
    gate: 'pnpm format:check',
    'format:check': ok,
    'docs:check': ok,
    typecheck: ok,
    lint: ok,
    test: ok,
    'test:db': ok,
    'test:deploy': ok,
    ...overrides,
  });
  // A kernel change after the sandbox commit (escalates the DB step), an assurance script and two app packages for
  // the API/Web typecheck steps.
  const prepare = (dir: string) => {
    mkdirSync(join(dir, 'kernel'), { recursive: true });
    writeFileSync(join(dir, 'kernel/changed.ts'), 'export const y = 2;\n');
    writeFileSync(join(dir, 'scripts/check-assurance.mjs'), '');
  };
  const appFiles = Object.fromEntries(
    ['api', 'web'].map((app) => [
      `${app}.json`,
      JSON.stringify({ name: `@daifuku/${app}`, private: true, scripts: { typecheck: ok } }),
    ]),
  );
  const workspace = (dir: string) => {
    for (const app of ['api', 'web']) {
      mkdirSync(join(dir, `apps/${app}`), { recursive: true });
      copyFileSync(join(dir, `${app}.json`), join(dir, `apps/${app}/package.json`));
    }
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
  };
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const waitFor = async (condition: () => boolean, ms: number) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (condition()) return true;
      await new Promise((done) => setTimeout(done, 100));
    }
    return condition();
  };
  const slow = (name: string) =>
    [
      "import { spawn } from 'node:child_process';",
      "import { writeFileSync } from 'node:fs';",
      "const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      `writeFileSync('${name}.json', JSON.stringify({ child: process.pid, grandchild: grandchild.pid }));`,
      'setInterval(() => {}, 1000);',
      '',
    ].join('\n');
  const pids = (dir: string, name: string) =>
    JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as { child: number; grandchild: number };
  const cleanup = (dir: string, names: string[], extra: (number | undefined)[] = []) => {
    const all = [...extra];
    for (const name of names)
      if (existsSync(join(dir, `${name}.json`))) {
        const found = pids(dir, name);
        all.push(found.child, found.grandchild);
      }
    for (const pid of all)
      if (pid && alive(pid))
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
    rmSync(dir, { recursive: true, force: true });
  };
  const gate = (dir: string): [string, string[]] => [
    process.execPath,
    [join(dir, 'scripts/gate.mjs'), '--tier', 'light'],
  ];
  it('AC-6 writes each laned step to its own log and prints one line per finished step', () => {
    const dir = sandbox(scripts(), appFiles);
    try {
      prepare(dir);
      workspace(dir);
      const [command, args] = gate(dir);
      const result = spawnSync(command, args, { cwd: dir, encoding: 'utf8', env, timeout: 50_000 });
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toMatch(/==> gate:light db \[db lane\]: pnpm test:db/);
      expect(result.stdout).toMatch(/<== gate:light unit: passed/);
      expect(result.stdout).toMatch(/Test Files {2}1 passed \(1\)/);
      expect(result.stdout).toMatch(/^concurrency: lanes side by side/m);
      const report = sandboxReport(dir, 'light');
      expect(report?.concurrency).toMatchObject({ parallel: true, dbShards: 1 });
      expect(report?.steps.length).toBe(10);
      for (const item of report?.steps ?? []) {
        expect(item.lane, item.id).toBe(item.id === 'db' ? 'db' : 'static');
        expect(Boolean(item.log && existsSync(join(dir, item.log))), item.id).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
  it('AC-5 a failing static step stops the DB lane and its whole process group', async () => {
    const failLater = [
      "import { existsSync } from 'node:fs';",
      "setInterval(() => { if (existsSync('db-pids.json')) process.exit(3); }, 50);",
      '',
    ].join('\n');
    const dir = sandbox(scripts({ 'test:db': 'node slow-db.mjs', 'format:check': 'node fail-later.mjs' }), {
      ...appFiles,
      'slow-db.mjs': slow('db-pids'),
      'fail-later.mjs': failLater,
    });
    try {
      prepare(dir);
      workspace(dir);
      const [command, args] = gate(dir);
      const result = spawnSync(command, args, { cwd: dir, encoding: 'utf8', env, timeout: 50_000 });
      expect(result.status, result.stdout + result.stderr).toBe(1);
      const found = pids(dir, 'db-pids');
      expect(await waitFor(() => !alive(found.child) && !alive(found.grandchild), 5_000)).toBe(true);
      const report = sandboxReport(dir, 'light');
      expect(report?.steps.find((item) => item.id === 'format')).toMatchObject({ result: 'failed' });
      expect(report?.steps.find((item) => item.id === 'db')).toMatchObject({
        result: 'cancelled',
        reason: 'stopped after format failed',
      });
      expect(report?.steps.find((item) => item.id === 'docs')).toMatchObject({ result: 'not-run' });
      expect(result.stdout).toMatch(/---- last lines of \.runtime\/gate\/\S+\/format\.log ----/);
    } finally {
      cleanup(dir, ['db-pids']);
    }
  }, 60_000);
  it('AC-5 SIGTERM stops both lanes and every descendant and reports interrupted', async () => {
    const dir = sandbox(scripts({ 'test:db': 'node slow-db.mjs', 'format:check': 'node slow-format.mjs' }), {
      ...appFiles,
      'slow-db.mjs': slow('db-pids'),
      'slow-format.mjs': slow('format-pids'),
    });
    let child: ReturnType<typeof spawn> | undefined;
    try {
      prepare(dir);
      workspace(dir);
      const started = spawn(process.execPath, [join(dir, 'scripts/gate.mjs'), '--tier', 'light'], {
        cwd: dir,
        stdio: 'ignore',
        env,
      });
      child = started;
      const exited = new Promise<number | null>((done) => started.once('exit', (code) => done(code)));
      const ready = () => existsSync(join(dir, 'db-pids.json')) && existsSync(join(dir, 'format-pids.json'));
      expect(await waitFor(ready, 30_000)).toBe(true);
      const all = [pids(dir, 'db-pids'), pids(dir, 'format-pids')].flatMap((found) => [found.child, found.grandchild]);
      started.kill('SIGTERM');
      const timeout = new Promise<string>((done) => setTimeout(() => done('still running after 20 s'), 20_000));
      expect(await Promise.race([exited, timeout])).toBe(143);
      expect(await waitFor(() => all.every((pid) => !alive(pid)), 5_000)).toBe(true);
      const report = sandboxReport(dir, 'light');
      expect(report?.result).toBe('interrupted');
      expect(report?.steps.find((item) => item.id === 'format')).toMatchObject({ result: 'failed' });
      expect(report?.steps.find((item) => item.id === 'db')).toMatchObject({ result: 'failed' });
      expect(report?.steps.find((item) => item.id === 'deploy')).toMatchObject({
        result: 'not-run',
        reason: 'interrupted',
      });
    } finally {
      cleanup(dir, ['db-pids', 'format-pids'], [child?.pid]);
    }
  }, 60_000);
});
