// Tier runner (docs/specs/test-tiers.md): change-set classification, escalation, base fallbacks, per-tier plans,
// preflight guidance, fail-fast semantics, dry-run and report shape. Each test name carries its AC id.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ALWAYS_DB_SUITES,
  ESCALATION_RULES,
  E2E_DATABASE_NAME,
  FILE_ARGUMENT_LIMIT,
  GUIDANCE,
  GateUsageError,
  IDENTITY_DATABASE_NAME,
  MAX_REPORTED_FILES,
  ROOT,
  applyPreflight,
  applySelection,
  browserPrerequisites,
  buildReport,
  classifyChanges,
  collectChangeSet,
  commandSummary,
  commandText,
  databaseUrl,
  detectEscalation,
  formatTable,
  gitRunner,
  globToRegExp,
  loadWorkspacePackages,
  packageOf,
  parseCli,
  parseGateScript,
  parseWorkspacePatterns,
  planSteps,
  provisionDatabaseName,
  provisionTargets,
  referenceTriggers,
  reportFileName,
  resolveBase,
  runSteps,
  selectByReference,
  selectByTestDirectory,
} from '../gate.mjs';
import type { Base, Change, Git, GitResult, Options, Step, Tier } from '../gate.mjs';

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
const gateScripts = parseGateScript(manifest.scripts.gate ?? '');
const packages = [
  { dir: 'kernel', name: '@daifuku/kernel' },
  { dir: 'modules/sales', name: '@daifuku/mod-sales' },
  { dir: 'modules/banking', name: '@daifuku/mod-banking' },
  { dir: 'apps/api', name: '@daifuku/api' },
  { dir: 'apps/web', name: '@daifuku/web' },
];
const base: Base = { ref: 'origin/main', commit: 'a'.repeat(40), source: 'merge-base', notes: [] };
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
  it('AC-15 falls back to HEAD~1 without origin/main', () => {
    const git = fakeGit({ [verify('HEAD')]: COMMIT, [verify('HEAD~1')]: 'c'.repeat(40) });
    const resolved = resolveBase({ git });
    expect(resolved).toMatchObject({ ref: 'HEAD~1', commit: 'c'.repeat(40), source: 'parent' });
    expect(resolved.notes.join(' ')).toMatch(/origin\/main is not available/);
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
    });
    expect(resolveBase({ git: fakeGit({}) })).toMatchObject({ ref: null, commit: null, source: 'none' });
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
    expect(find(steps, 'typecheck:api').skip?.result).toBe('skipped');
    expect(find(steps, 'deploy').skip?.result).toBe('skipped');
    expect(find(steps, 'unit').selection).toEqual({
      project: 'unit',
      sources: ['modules/sales/src/services/recalculate.ts'],
      triggers: cls.all,
      extra: [],
    });
    expect(cls.packages).toEqual(['@daifuku/mod-sales']);
  });
  it('AC-1 adds the API or Web typecheck only when that app changed', () => {
    expect(commandText(find(plan('quick', ['apps/web/src/pages/home-page.tsx']).steps, 'typecheck:web').command)).toBe(
      'pnpm --filter @daifuku/web typecheck',
    );
    expect(find(plan('quick', ['apps/web/src/pages/home-page.tsx']).steps, 'typecheck:api').skip).not.toBeNull();
    expect(commandText(find(plan('quick', ['apps/api/test/api.db.test.ts']).steps, 'typecheck:api').command)).toBe(
      'pnpm --filter @daifuku/api typecheck',
    );
    expect(find(plan('quick', ['apps/web/src/styles.css']).steps, 'typecheck:web').skip?.reason).toBe(
      'apps/web unchanged',
    );
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
  it('AC-3 runs whole static checks, every unit test and related DB suites plus the kernel sentinels', () => {
    const { steps } = plan('light', ['modules/banking/src/matching.ts']);
    expect(steps.map((item) => [item.id, commandText(item.command)])).toEqual([
      ['format', 'pnpm format:check'],
      ['docs', 'pnpm docs:check'],
      ['assurance', `node scripts/check-assurance.mjs --changed ${base.commit}`],
      ['typecheck', 'pnpm typecheck'],
      ['typecheck:api', ''],
      ['typecheck:web', ''],
      ['lint', 'pnpm lint'],
      ['unit', 'pnpm test'],
      ['db', ''],
      ['deploy', 'pnpm test:deploy'],
    ]);
    expect(find(steps, 'db').selection).toMatchObject({
      project: 'db',
      sources: ['modules/banking/src/matching.ts'],
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

describe('AC-4 escalation', () => {
  it.each([
    'kernel/src/decimal.ts',
    'apps/api/drizzle/migrations/0001_init.sql',
    'apps/api/src/db/reset.ts',
    'apps/api/src/modules.ts',
    'apps/api/test/payroll-provider-setup.ts',
    'modules/sales/package.json',
    'pnpm-lock.yaml',
    'tsconfig.base.json',
    'apps/web/tsconfig.json',
    'vitest.config.mts',
    'eslint.config.js',
    '.github/workflows/ci.yml',
    'scripts/gate.mjs',
  ])('AC-4 escalates %s', (path) => {
    expect(detectEscalation(changesOf([path])).required).toBe(true);
  });
  it.each([
    'modules/sales/src/index.ts',
    'apps/web/src/pages/home-page.tsx',
    'docs/specs/test-tiers.md',
    'scripts/metrics-add.mjs',
  ])('AC-4 does not escalate %s', (path) => {
    expect(detectEscalation(changesOf([path])).required).toBe(false);
  });
  it('AC-4 light runs every DB suite for kernel changes while quick keeps its steps and reports the notice', () => {
    const light = plan('light', ['kernel/src/decimal.ts']);
    expect(commandText(find(light.steps, 'db').command)).toBe('pnpm test:db');
    expect(light.escalation.reasons).toEqual([
      { path: 'kernel/src/decimal.ts', rule: 'kernel/**', why: expect.any(String) },
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
    expect(report.escalation).toMatchObject({ required: true, message: 'includes changes that need full regression' });
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
  it('AC-4 every escalation rule matches at least one path form', () => {
    for (const rule of ESCALATION_RULES) expect(globToRegExp(rule.pattern).source.startsWith('^')).toBe(true);
    expect(globToRegExp('**/tsconfig*.json').test('tsconfig.json')).toBe(true);
    expect(globToRegExp('**/tsconfig*.json').test('apps/web/tsconfig.json')).toBe(true);
    expect(globToRegExp('kernel/**').test('kernelx/src/a.ts')).toBe(false);
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
});

describe('AC-18 explicit DB-test variables', () => {
  it('AC-18 blocks DB suites without TEST_DATABASE_URL_OWNER/TEST_DATABASE_URL instead of using daifuku_test', () => {
    const steps = applyPreflight(plan('light', ['modules/banking/src/matching.ts']).steps, {
      env: {},
      options: options({ tier: 'light' }),
    });
    expect(find(steps, 'db').blocked).toBe(GUIDANCE.testDb);
    expect(GUIDANCE.testDb).toMatch(/never falls back to the default daifuku_test/);
    const allowed = applyPreflight(plan('light', ['modules/banking/src/matching.ts']).steps, {
      env: fullEnv,
      options: options({ tier: 'light' }),
    });
    expect(find(allowed, 'db').blocked).toBeNull();
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
    expect(report.skipped.map((item) => item.id)).toEqual(['typecheck:api', 'typecheck:web', 'deploy']);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
  it('AC-7 prints a table that matches the JSON report', () => {
    const table = formatTable(report);
    for (const item of report.steps)
      expect(table).toMatch(new RegExp(`^${item.id.replace(':', '\\:')}\\s+${item.result}`, 'm'));
    expect(table).toMatch(/3\/124 files/);
    expect(table).toContain(`base=origin/main@${base.commit?.slice(0, 7)} (merge-base)`);
    expect(table).toMatch(/escalation: includes changes that need full regression/);
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
    expect(ran).toEqual(['format', 'docs', 'assurance', 'typecheck', 'lint', 'unit', 'db', 'deploy']);
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
  it('AC-13 dry-run prints the plan and writes a report without running any step', () => {
    const result = spawnSync(
      process.execPath,
      [join(ROOT, 'scripts/gate.mjs'), '--tier', 'full', '--dry-run', '--without-browser'],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, GATE_BASE: 'HEAD' } },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/gate:full {2}result=dry-run/);
    expect(result.stdout).toMatch(/^format:check|^format\s+planned/m);
    const file = /report: (\.runtime\/gate\/\S+-full\.json)/.exec(result.stdout)?.[1];
    if (!file) throw new Error(result.stdout + result.stderr);
    const report = JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as {
      dryRun: boolean;
      steps: { result: string; seconds: number }[];
      partial: boolean;
    };
    expect(report.dryRun).toBe(true);
    expect(report.partial).toBe(true);
    expect(
      report.steps.every((item) => ['planned', 'skipped', 'blocked'].includes(item.result) && item.seconds === 0),
    ).toBe(true);
    rmSync(join(ROOT, file));
  });
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
        selected: { file: string; via: string }[];
      };
      expect(selection.total).toBeGreaterThan(100);
      expect(selection.selected).toContainEqual({ file: 'scripts/test/gate.test.ts', via: 'graph' });
      expect(selection.selected).toContainEqual({ file: 'modules/sales/test/recalculate.test.ts', via: 'directory' });
      expect(selection.selected.some((entry) => entry.file.endsWith('.db.test.ts'))).toBe(false);
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
