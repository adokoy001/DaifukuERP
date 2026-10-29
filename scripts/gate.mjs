#!/usr/bin/env node
// Tiered regression runner (docs/specs/test-tiers.md): quick = checks limited to the change set, light = whole-repo
// static checks + every unit test + related DB suites, full = every `pnpm gate` step + API/Web builds + browser suites.
// Selection only chooses which existing checks run; it never skips, filters or weakens a test, and `pnpm gate` is
// unchanged. Pure planning functions are exported for scripts/test/gate.test.ts; process work stays in the runner below.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { basename, dirname, extname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TIERS = Object.freeze(['quick', 'light', 'full']);
// Mirrors the `format` / `format:check` globs in package.json.
export const FORMAT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css']);
export const LINT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);
// Files that vitest can follow through its module graph.
export const MODULE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
// Above this many files a file-limited command is replaced by its whole-repository form.
export const FILE_ARGUMENT_LIMIT = 300;
export const MAX_REPORTED_FILES = 200;
// Kernel sentinels that light runs regardless of the change set.
export const ALWAYS_DB_SUITES = Object.freeze([
  'kernel/test/foundation.db.test.ts',
  'kernel/test/document.db.test.ts',
  'kernel/test/access-boundary.db.test.ts',
  'kernel/test/noninterference.db.test.ts',
]);
// Changes that quick/light cannot cover by selection. light widens DB suites to all; quick reports the notice.
export const ESCALATION_RULES = Object.freeze([
  { pattern: 'kernel/**', why: 'the kernel is imported by every module and DB suite' },
  { pattern: 'apps/api/drizzle/**', why: 'migrations' },
  { pattern: 'apps/api/src/db/**', why: 'schema, seed and fixture tooling' },
  { pattern: 'apps/api/src/modules.ts', why: 'module registration' },
  { pattern: 'apps/api/test/payroll-provider-setup.ts', why: 'DB project setup file, outside the module graph' },
  { pattern: 'vitest.config.mts', why: 'test project definitions' },
  { pattern: '**/package.json', why: 'dependencies and scripts' },
  { pattern: 'pnpm-lock.yaml', why: 'dependency versions' },
  { pattern: 'pnpm-workspace.yaml', why: 'workspace layout' },
  { pattern: '**/tsconfig*.json', why: 'compiler settings' },
  { pattern: 'eslint.config.js', why: 'lint rules' },
  { pattern: '.dependency-cruiser.cjs', why: 'dependency boundaries' },
  { pattern: '.prettierrc.json', why: 'formatting rules' },
  { pattern: '.prettierignore', why: 'formatting scope' },
  { pattern: 'turbo.json', why: 'task graph' },
  { pattern: '.github/**', why: 'CI definitions' },
  { pattern: 'scripts/gate.mjs', why: 'this tier runner' },
  { pattern: 'scripts/gate-select.mjs', why: 'test selection' },
]);
// quick replaces a file-limited step by its whole-repository form when its own configuration changed.
export const WIDEN_RULES = Object.freeze({
  format: ['.prettierrc.json', '.prettierignore', 'package.json', 'pnpm-lock.yaml'],
  eslint: ['eslint.config.js', 'package.json', 'pnpm-lock.yaml'],
  unit: ['vitest.config.mts', '**/package.json', 'pnpm-lock.yaml', '**/tsconfig*.json'],
});
// Release tooling exercised only by `pnpm test:deploy` (node --test, outside vitest).
export const DEPLOY_PATTERNS = Object.freeze([
  'deploy/**',
  'scripts/build-api.mjs',
  'scripts/build-release.mjs',
  'scripts/verify-release.mjs',
  'scripts/deploy-plan.mjs',
]);
// Basenames too generic for the text-reference rule; their changes are covered by escalation and widening.
const REFERENCE_IGNORED = new Set(['package.json', 'tsconfig.json', 'README.md', 'index.html', 'LICENSE']);
const APP_PACKAGES = Object.freeze({ api: '@daifuku/api', web: '@daifuku/web' });
// Mirror the database-name rules of apps/api/src/db/e2e-fixture.ts and apps/api/test/identity-e2e-database.ts.
export const E2E_DATABASE_NAME = /^(daifuku_ci_e2e|daifuku_e2e_test(?:_[a-z0-9]+)?)$/;
export const IDENTITY_DATABASE_NAME = /^daifuku_(?:ci_enterprise_e2e|e2e_test_enterprise(?:_[a-z0-9]+)?)$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const SYNTHETIC_JWT_SECRET = 'synthetic-local-gate-only-not-for-deployment';
const PLAYWRIGHT = ['--filter', '@daifuku/web', 'exec', 'playwright', 'test'];

export const GUIDANCE = Object.freeze({
  testDb:
    'DB suites drop and recreate the schema of the database they use. Export TEST_DATABASE_URL_OWNER and TEST_DATABASE_URL ' +
    'for a dedicated disposable test database (CONTRIBUTING.md, section "型・単体・DB・Web の検証"). The tier runner never ' +
    'falls back to the default daifuku_test database.',
  browser:
    'Browser suites need a prepared empty fixture database and running API/Web (CONTRIBUTING.md, section "ブラウザ試験を新規環境で再現する"): ' +
    'set DATABASE_URL_OWNER, DATABASE_URL, E2E_PREPARE=1, E2E_INVOICE_DATE, E2E_API_URL and E2E_BASE_URL and start both servers; ' +
    'or rerun with --provision (loopback PostgreSQL, owner role with CREATEDB); or with --without-browser for a partial run.',
  identity:
    'The identity suite needs its own NEW empty database daifuku_e2e_test_enterprise[_suffix]: set GATE_IDENTITY_DATABASE_URL_OWNER ' +
    'and GATE_IDENTITY_DATABASE_URL (passed to pnpm test:identity:e2e as TEST_DATABASE_URL_* for that step only; CONTRIBUTING.md, ' +
    'section "認証ブラウザ試験"); or rerun with --provision; or with --without-browser for a partial run.',
  provision:
    '--provision creates NEW databases on the server of TEST_DATABASE_URL_OWNER: both TEST_DATABASE_URL_OWNER and TEST_DATABASE_URL ' +
    'must be loopback postgres URLs on the same server, the owner role needs CREATEDB, and the app role must be daifuku_app.',
  smoke:
    '--with-smoke needs reachable E2E_BASE_URL and E2E_API_URL servers on a prepared fixture (CONTRIBUTING.md, section ' +
    '"ブラウザ試験を新規環境で再現する"), or --provision.',
});

export class GateUsageError extends Error {}

// ---- small pure helpers ----------------------------------------------------------------------------------------

export function globToRegExp(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (char === '*') source += '[^/]*';
    else source += /[\\^$.|?+()[\]{}]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`^${source}$`);
}

export function matchesAny(path, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

export function isTestFile(path) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

function isUnderPackageRoot(path) {
  return /^(kernel|modules|l10n|packs|apps)\//.test(path);
}

// Deleted files that other code may still import: module sources and data, but not tests or documentation.
export function isDeletedSource(change) {
  if (!change.deleted || isTestFile(change.path) || change.path.startsWith('docs/')) return false;
  return MODULE_EXTENSIONS.has(extname(change.path)) || ['.json', '.sql'].includes(extname(change.path));
}

export function quoteArg(arg) {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;
}

export function commandText(command) {
  if (!command) return '';
  return [command.program, ...command.args].map(quoteArg).join(' ');
}

// Table form: file arguments collapse to a count; the JSON report keeps the full command.
export function commandSummary(command) {
  if (!command) return '';
  const files = command.args.filter((arg) => arg.startsWith('./') || arg.startsWith('/'));
  if (files.length <= 1) return commandText(command);
  const rest = command.args.filter((arg) => !files.includes(arg));
  return `${commandText({ program: command.program, args: rest })} <${files.length} files>`;
}

// ---- base and change set ------------------------------------------------------------------------------------

export function resolveBase({ explicit, env = {}, git }) {
  const requested = explicit ?? env.GATE_BASE;
  const verify = (ref) => {
    const result = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return result.ok && result.stdout.trim() ? result.stdout.trim() : null;
  };
  const notes = [];
  if (requested !== undefined && requested !== '') {
    const origin = explicit === undefined ? 'GATE_BASE' : '--base';
    if (requested.startsWith('-')) throw new GateUsageError(`${origin} must name a git commit, not an option.`);
    const commit = verify(requested);
    if (!commit) throw new GateUsageError(`${origin} ${requested} is not a commit in this repository.`);
    return { ref: requested, commit, source: explicit === undefined ? 'env' : 'option', notes };
  }
  const head = verify('HEAD');
  if (!head) {
    notes.push('HEAD has no commit yet; only staged and untracked files are considered.');
    return { ref: null, commit: null, source: 'none', notes };
  }
  if (verify('origin/main')) {
    const mergeBase = git(['merge-base', 'HEAD', 'origin/main']);
    if (mergeBase.ok && mergeBase.stdout.trim())
      return { ref: 'origin/main', commit: mergeBase.stdout.trim(), source: 'merge-base', notes };
    notes.push('merge-base(HEAD, origin/main) is unavailable (shallow or unrelated history); falling back to HEAD~1.');
  } else notes.push('origin/main is not available; falling back to HEAD~1.');
  const parent = verify('HEAD~1');
  if (parent) return { ref: 'HEAD~1', commit: parent, source: 'parent', notes };
  notes.push('HEAD has no parent in this clone; only uncommitted changes are considered.');
  return { ref: 'HEAD', commit: head, source: 'head', notes };
}

// Union of committed (base..HEAD), staged, unstaged and untracked paths. NUL-separated output keeps spaces and
// non-ASCII names intact; --no-renames reports a rename as a deletion plus an addition. A path counts as deleted
// when it no longer exists in the working tree, whichever source reported it.
export function collectChangeSet({ base, git, exists }) {
  const read = (args) => {
    const result = git(args);
    if (!result.ok) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim() || 'unknown error'}`);
    return result.stdout.split('\0').filter(Boolean);
  };
  const lists = [];
  if (base.commit && base.source !== 'head')
    lists.push(read(['diff', '--name-only', '--no-renames', '-z', base.commit, 'HEAD', '--']));
  if (base.commit) lists.push(read(['diff', '--name-only', '--no-renames', '-z', '--cached', '--']));
  else lists.push(read(['ls-files', '--cached', '-z']));
  lists.push(read(['diff', '--name-only', '--no-renames', '-z', '--']));
  lists.push(read(['ls-files', '--others', '--exclude-standard', '-z']));
  return [...new Set(lists.flat())].sort().map((path) => ({ path, deleted: !exists(path) }));
}

// ---- workspace packages ----------------------------------------------------------------------------------------

export function parseWorkspacePatterns(yaml) {
  return yaml
    .split('\n')
    .map((line) => /^\s*-\s*['"]?([^'"#\s]+)['"]?\s*(?:#.*)?$/.exec(line)?.[1])
    .filter(Boolean);
}

export function loadWorkspacePackages(root = ROOT) {
  const packages = [];
  for (const pattern of parseWorkspacePatterns(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'))) {
    const dirs = pattern.endsWith('/*')
      ? readdirSync(join(root, pattern.slice(0, -2)), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => `${pattern.slice(0, -2)}/${entry.name}`)
      : [pattern];
    for (const dir of dirs) {
      const manifest = join(root, dir, 'package.json');
      if (existsSync(manifest)) packages.push({ dir, name: JSON.parse(readFileSync(manifest, 'utf8')).name });
    }
  }
  return packages;
}

export function packageOf(path, packages) {
  let best = null;
  for (const pkg of packages)
    if (path.startsWith(`${pkg.dir}/`) && (!best || pkg.dir.length > best.dir.length)) best = pkg;
  return best;
}

// ---- classification and escalation -------------------------------------------------------------------------------

export function classifyChanges(changes, packages = []) {
  const all = changes.map((change) => change.path);
  const present = changes.filter((change) => !change.deleted).map((change) => change.path);
  const deletedSources = changes.filter(isDeletedSource).map((change) => change.path);
  const typeRelevant = (path) => MODULE_EXTENSIONS.has(extname(path)) || extname(path) === '.json';
  const inApp = (app) => all.some((path) => path.startsWith(`apps/${app}/`) && typeRelevant(path));
  const widen = (rule) => all.filter((path) => matchesAny(path, WIDEN_RULES[rule]));
  return {
    all,
    present,
    deleted: changes.filter((change) => change.deleted).map((change) => change.path),
    deletedSources,
    formattable: present.filter((path) => FORMAT_EXTENSIONS.has(extname(path))),
    lintable: present.filter((path) => LINT_EXTENSIONS.has(extname(path))),
    markdown: all.filter((path) => extname(path) === '.md'),
    typecheck: all.some(typeRelevant),
    boundaries: all.some(
      (path) =>
        (isUnderPackageRoot(path) && MODULE_EXTENSIONS.has(extname(path))) ||
        path === '.dependency-cruiser.cjs' ||
        path.endsWith('package.json'),
    ),
    apps: { api: inApp('api'), web: inApp('web') },
    browserSpecs: all.filter((path) => path.startsWith('apps/web/e2e/')),
    deploy: all.filter((path) => matchesAny(path, DEPLOY_PATTERNS)),
    widen: { format: widen('format'), eslint: widen('eslint'), unit: [...widen('unit'), ...deletedSources] },
    packages: [...new Set(all.map((path) => packageOf(path, packages)?.name).filter(Boolean))].sort(),
  };
}

export function detectEscalation(changes, rules = ESCALATION_RULES) {
  const reasons = [];
  for (const change of changes) {
    const rule = rules.find((candidate) => globToRegExp(candidate.pattern).test(change.path));
    if (rule) reasons.push({ path: change.path, rule: rule.pattern, why: rule.why });
    else if (isDeletedSource(change))
      reasons.push({
        path: change.path,
        rule: 'deleted-source',
        why: 'a deleted source cannot be followed by module-graph selection',
      });
  }
  return { required: reasons.length > 0, reasons };
}

// ---- selection rules applied on top of the vitest module graph (used by scripts/gate-select.mjs) ----------------

// Changed files outside the module graph (data, docs, subprocess scripts) that tests may read or execute by name.
export function referenceTriggers(paths) {
  return paths.filter(
    (path) =>
      (!MODULE_EXTENSIONS.has(extname(path)) || /^(scripts|deploy|verification)\//.test(path)) &&
      !REFERENCE_IGNORED.has(basename(path)),
  );
}

export function selectByReference(triggers, specFiles, readText) {
  const names = [...new Set(triggers.map((path) => basename(path)))];
  if (!names.length) return [];
  return specFiles.filter((file) => {
    const text = readText(file);
    return names.some((name) => text.includes(name));
  });
}

// A changed non-module file inside a test directory (golden data, fixtures) selects every spec in that directory.
export function selectByTestDirectory(paths, specFiles) {
  const directories = paths
    .filter((path) => !MODULE_EXTENSIONS.has(extname(path)))
    .map((path) => /^(.*?\/)?(test|e2e)\//.exec(path)?.[0])
    .filter(Boolean);
  return specFiles.filter((file) => directories.some((directory) => file.startsWith(directory)));
}

// ---- planning ----------------------------------------------------------------------------------------------------

export function parseGateScript(script) {
  const parts = script.split('&&').map((part) => part.trim());
  const names = parts.map((part) => /^pnpm (?:run )?([\w:-]+)$/.exec(part)?.[1]);
  return names.every(Boolean) ? names : null;
}

const GATE_STEP_IDS = Object.freeze({
  'format:check': 'format',
  typecheck: 'typecheck',
  lint: 'lint',
  test: 'unit',
  'test:db': 'db',
  'test:deploy': 'deploy',
  'docs:check': 'docs',
  'verify:assurance': 'assurance',
});

function step(id, command, extra = {}) {
  return { id, command, env: {}, selection: null, skip: null, blocked: null, special: null, note: null, ...extra };
}
const pnpm = (...args) => ({ program: 'pnpm', args });
const skipped = (id, reason, result = 'skipped') => step(id, null, { skip: { result, reason } });

function fileStep(id, files, fileArgs, wholeCommand) {
  if (!files.length) return skipped(id, 'no matching changed file', 'no-target');
  if (files.length > FILE_ARGUMENT_LIMIT)
    return step(id, wholeCommand, { note: `${files.length} files exceed ${FILE_ARGUMENT_LIMIT}; whole repository` });
  return step(id, pnpm(...fileArgs(files.map((file) => `./${file}`))), { selected: { files: files.length } });
}

function assuranceStep(base) {
  return base.commit
    ? step('assurance', { program: 'node', args: ['scripts/check-assurance.mjs', '--changed', base.commit] })
    : step('assurance', pnpm('verify:assurance'));
}

function appTypechecks(cls) {
  return Object.entries(APP_PACKAGES).map(([app, name]) =>
    cls.apps[app]
      ? step(`typecheck:${app}`, pnpm('--filter', name, 'typecheck'))
      : skipped(`typecheck:${app}`, `apps/${app} unchanged`),
  );
}

function planQuick({ cls, base }) {
  if (!cls.all.length) return [];
  const steps = [];
  if (cls.widen.format.length)
    steps.push(step('format', pnpm('format:check'), { note: `widened by ${cls.widen.format.join(', ')}` }));
  else
    steps.push(
      fileStep('format', cls.formattable, (files) => ['exec', 'prettier', '--check', ...files], pnpm('format:check')),
    );
  steps.push(step('docs', pnpm('docs:check')), assuranceStep(base));
  if (cls.widen.eslint.length)
    steps.push(step('eslint', pnpm('exec', 'eslint', '.'), { note: `widened by ${cls.widen.eslint.join(', ')}` }));
  else
    steps.push(
      fileStep(
        'eslint',
        cls.lintable,
        (files) => ['exec', 'eslint', '--no-warn-ignored', ...files],
        pnpm('exec', 'eslint', '.'),
      ),
    );
  steps.push(
    cls.boundaries
      ? step('boundaries', pnpm('lint:boundaries'))
      : skipped('boundaries', 'no change under kernel/modules/l10n/packs/apps'),
    cls.typecheck ? step('typecheck', pnpm('typecheck')) : skipped('typecheck', 'no TypeScript-relevant change'),
    ...appTypechecks(cls),
  );
  steps.push(
    cls.widen.unit.length
      ? step('unit', pnpm('test'), { note: `widened to every unit test by ${cls.widen.unit.join(', ')}` })
      : step('unit', null, { selection: { project: 'unit', sources: cls.present, triggers: cls.all, extra: [] } }),
  );
  steps.push(
    cls.deploy.length
      ? step('deploy', pnpm('test:deploy'), { note: `release tooling changed: ${cls.deploy.join(', ')}` })
      : skipped('deploy', 'no deploy/ or release script change'),
  );
  return steps;
}

function dbStep(cls, escalation) {
  if (escalation.required)
    return step('db', pnpm('test:db'), { note: 'escalated: every DB suite (see escalation reasons)' });
  return step('db', null, {
    selection: { project: 'db', sources: cls.present, triggers: cls.all, extra: [...ALWAYS_DB_SUITES] },
  });
}

function smokeSteps(options) {
  const steps = [];
  if (options.provision)
    steps.push(step('build:api', pnpm('build:api')), step('browser:prepare', null, { special: 'browser:prepare' }));
  steps.push(
    step('smoke', pnpm(...PLAYWRIGHT, '--grep', '@smoke', ...options.playwrightArgs), {
      special: 'smoke',
      note: 'Playwright also runs the industry dependency project',
    }),
  );
  return steps;
}

function planLight({ cls, base, escalation, options }) {
  const steps = [
    step('format', pnpm('format:check')),
    step('docs', pnpm('docs:check')),
    assuranceStep(base),
    step('typecheck', pnpm('typecheck')),
    ...appTypechecks(cls),
    step('lint', pnpm('lint')),
    step('unit', pnpm('test')),
    dbStep(cls, escalation),
    step('deploy', pnpm('test:deploy')),
  ];
  if (options.withSmoke) steps.push(...smokeSteps(options));
  return steps;
}

function planFull({ options, gateScripts }) {
  const gate = gateScripts
    ? gateScripts.map((name) => step(GATE_STEP_IDS[name] ?? name, pnpm(name)))
    : [step('gate', pnpm('gate'), { note: 'package.json gate script is not a plain pnpm chain; run as a whole' })];
  const steps = [
    ...gate,
    step('typecheck:api', pnpm('--filter', APP_PACKAGES.api, 'typecheck')),
    step('build:api', pnpm('build:api')),
    step('build:edge', pnpm('--filter', '@daifuku/edge', 'build')),
    step('typecheck:web', pnpm('--filter', APP_PACKAGES.web, 'typecheck')),
    step('build:web', pnpm('--filter', APP_PACKAGES.web, 'build')),
  ];
  if (options.withoutBrowser)
    steps.push(
      skipped('browser', '--without-browser (partial run)'),
      skipped('identity', '--without-browser (partial run)'),
    );
  else {
    if (options.provision) steps.push(step('browser:prepare', null, { special: 'browser:prepare' }));
    steps.push(
      step('browser', pnpm(...PLAYWRIGHT, '--reporter=list', ...options.playwrightArgs), { special: 'browser' }),
      step('identity', pnpm('test:identity:e2e'), { special: 'identity' }),
    );
  }
  return steps;
}

export function planSteps({ tier, cls, base, escalation, options, gateScripts = null }) {
  if (tier === 'quick') return planQuick({ cls, base });
  if (tier === 'light') return planLight({ cls, base, escalation, options });
  return planFull({ options, gateScripts });
}

// ---- preflight (prerequisites that would otherwise fail late) ------------------------------------------------------

export function provisionTargets(env) {
  let owner;
  let app;
  try {
    owner = new URL(env.TEST_DATABASE_URL_OWNER ?? 'invalid:');
    app = new URL(env.TEST_DATABASE_URL ?? 'invalid:');
  } catch {
    return null;
  }
  const valid = [owner, app].every(
    (url) =>
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
      LOOPBACK_HOSTS.has(url.hostname) &&
      !url.search &&
      !url.hash &&
      url.username,
  );
  if (!valid || owner.host !== app.host || owner.username === app.username || app.username !== 'daifuku_app')
    return null;
  return { owner, app };
}

export function browserPrerequisites(env, reach = {}) {
  const missing = ['DATABASE_URL_OWNER', 'DATABASE_URL', 'E2E_API_URL', 'E2E_BASE_URL'].filter((name) => !env[name]);
  if (env.E2E_PREPARE !== '1') missing.push('E2E_PREPARE=1');
  if (env.E2E_API_URL && !reach.api) missing.push(`reachable ${env.E2E_API_URL}/health`);
  if (env.E2E_BASE_URL && !reach.web) missing.push(`reachable ${env.E2E_BASE_URL}`);
  return missing;
}

export function applyPreflight(steps, { env, options, reach = {} }) {
  const block = (target, guidance, missing = []) => ({
    ...target,
    blocked: missing.length ? `${guidance} Missing: ${missing.join(', ')}.` : guidance,
  });
  const provision = options.provision ? provisionTargets(env) : null;
  return steps.map((item) => {
    if (item.skip) return item;
    if (item.id === 'db' && (!env.TEST_DATABASE_URL_OWNER || !env.TEST_DATABASE_URL))
      return block(item, GUIDANCE.testDb);
    if (item.special === 'browser:prepare' && !provision) return block(item, GUIDANCE.provision);
    if (item.special === 'browser' && !options.provision) {
      const missing = browserPrerequisites(env, reach);
      return missing.length ? block(item, GUIDANCE.browser, missing) : item;
    }
    if (item.special === 'smoke' && !options.provision) {
      const missing = browserPrerequisites(env, reach);
      return missing.length ? block(item, GUIDANCE.smoke, missing) : item;
    }
    if (item.special === 'identity') {
      if (options.provision) return provision ? item : block(item, GUIDANCE.provision);
      if (!env.GATE_IDENTITY_DATABASE_URL_OWNER || !env.GATE_IDENTITY_DATABASE_URL)
        return block(item, GUIDANCE.identity);
    }
    return item;
  });
}

// ---- selection results -> commands -------------------------------------------------------------------------------

export function applySelection(item, selection, root = ROOT) {
  const files = selection.selected.map((entry) => entry.file);
  const via = {};
  for (const entry of selection.selected) via[entry.via] = (via[entry.via] ?? 0) + 1;
  const selected = { files: files.length, total: selection.total, via };
  if (!files.length) return { ...item, selected, skip: { result: 'no-target', reason: 'no related test file' } };
  return {
    ...item,
    selected,
    selectedFiles: files,
    command: pnpm('exec', 'vitest', 'run', '--project', selection.project, ...files.map((file) => join(root, file))),
  };
}

// ---- execution ---------------------------------------------------------------------------------------------------

// Runs planned steps in order. Fail-fast by default: a missing prerequisite fails before anything runs, and after
// the first failure the remaining steps are "not-run". --keep-going runs every runnable step and still fails.
export async function runSteps(steps, { keepGoing = false, execute, prepare = async (item) => item, now = () => 0 }) {
  const firstBlocked = keepGoing ? null : steps.find((item) => item.blocked && !item.skip);
  if (firstBlocked)
    return {
      ok: false,
      interrupted: false,
      steps: steps.map((item) => {
        if (item.skip) return { ...item, result: item.skip.result, seconds: 0, reason: item.skip.reason };
        if (item.blocked) return { ...item, result: 'failed', seconds: 0, reason: item.blocked };
        return { ...item, result: 'not-run', seconds: 0, reason: `missing prerequisite for ${firstBlocked.id}` };
      }),
    };
  const results = [];
  let failed = false;
  let stopped = false;
  for (const planned of steps) {
    if (planned.skip) {
      results.push({ ...planned, result: planned.skip.result, seconds: 0, reason: planned.skip.reason });
      continue;
    }
    if (stopped || (failed && !keepGoing)) {
      results.push({
        ...planned,
        result: 'not-run',
        seconds: 0,
        reason: stopped ? 'interrupted' : 'an earlier step failed',
      });
      continue;
    }
    if (planned.blocked) {
      failed = true;
      results.push({ ...planned, result: 'failed', seconds: 0, reason: planned.blocked });
      continue;
    }
    const started = now();
    let item = planned;
    let outcome;
    try {
      item = await prepare(planned);
      outcome = item.skip ? { ok: true, result: item.skip.result, reason: item.skip.reason } : await execute(item);
    } catch (error) {
      outcome = { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    const seconds = Math.round((now() - started) * 10) / 10;
    const result = outcome.result ?? (outcome.ok ? 'passed' : 'failed');
    results.push({ ...item, result, seconds, reason: outcome.reason ?? item.skip?.reason ?? null });
    if (!outcome.ok) failed = true;
    if (outcome.interrupted) stopped = true;
  }
  return { steps: results, ok: !failed && !stopped, interrupted: stopped };
}

// ---- report ------------------------------------------------------------------------------------------------------

export function buildReport({
  tier,
  options,
  base,
  head = null,
  changes,
  cls,
  escalation,
  steps,
  startedAt,
  finishedAt,
  result,
  provisioned = null,
}) {
  const partialReasons = [];
  if (options.withoutBrowser) partialReasons.push('--without-browser: browser and identity suites not run');
  if (options.playwrightArgs?.length)
    partialReasons.push(`custom Playwright arguments: ${options.playwrightArgs.join(' ')}`);
  const hints = [];
  if (cls.browserSpecs.length && tier !== 'full')
    hints.push('apps/web/e2e changed: run the changed specs with the browser procedure, or pnpm gate:full.');
  if (escalation.required && tier !== 'full')
    hints.push('Full regression required before claiming done: run pnpm gate:full.');
  return {
    schema: 1,
    tier,
    result,
    dryRun: Boolean(options.dryRun),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    seconds: Math.round((finishedAt.getTime() - startedAt.getTime()) / 100) / 10,
    head,
    base,
    changed: {
      count: changes.length,
      deleted: changes.filter((change) => change.deleted).length,
      files: changes
        .slice(0, MAX_REPORTED_FILES)
        .map((change) => (change.deleted ? `${change.path} (deleted)` : change.path)),
      truncated: changes.length > MAX_REPORTED_FILES,
    },
    packages: cls.packages,
    escalation: {
      required: escalation.required,
      message: escalation.required ? 'includes changes that need full regression' : null,
      reasons: escalation.reasons,
    },
    partial: partialReasons.length > 0,
    partialReasons,
    skipped: steps
      .filter((item) => ['skipped', 'not-run', 'no-target'].includes(item.result))
      .map((item) => ({ id: item.id, result: item.result, reason: item.reason ?? item.skip?.reason ?? null })),
    steps: steps.map((item) => ({
      id: item.id,
      result: item.result,
      seconds: item.seconds ?? 0,
      selected: item.selected ?? null,
      command: commandText(item.command),
      summary: commandSummary(item.command),
      note: item.note ?? null,
      reason: item.reason ?? item.skip?.reason ?? item.blocked ?? null,
    })),
    options: {
      keepGoing: Boolean(options.keepGoing),
      withSmoke: Boolean(options.withSmoke),
      withoutBrowser: Boolean(options.withoutBrowser),
      provision: Boolean(options.provision),
      playwrightArgs: options.playwrightArgs ?? [],
    },
    provisioned,
    hints,
  };
}

function selectionText(selected) {
  if (!selected) return '';
  const unit = selected.files === 1 && selected.total === undefined ? 'file' : 'files';
  return selected.total === undefined ? `${selected.files} ${unit}` : `${selected.files}/${selected.total} files`;
}

// Table cells stay one line; the full text (guidance, commands) is printed below the table and kept in the JSON.
const TABLE_DETAIL_LIMIT = 110;
function truncate(text) {
  return text.length > TABLE_DETAIL_LIMIT ? `${text.slice(0, TABLE_DETAIL_LIMIT - 3)}...` : text;
}

export function formatTable(report) {
  const base = report.base.commit
    ? `${report.base.ref}@${report.base.commit.slice(0, 7)} (${report.base.source})`
    : `${report.base.ref ?? 'none'} (${report.base.source})`;
  const lines = [
    `gate:${report.tier}  result=${report.result}  base=${base}  changed=${report.changed.count} (deleted ${report.changed.deleted})  ${report.seconds}s`,
  ];
  for (const note of report.base.notes) lines.push(`  note: ${note}`);
  const rows = report.steps.map((item) => [
    item.id,
    item.result,
    item.result === 'passed' || item.result === 'failed' ? item.seconds.toFixed(1) : '-',
    selectionText(item.selected),
    truncate(item.reason && item.result !== 'passed' ? item.reason : item.note || item.summary),
  ]);
  const header = ['step', 'result', 'seconds', 'selected', 'detail'];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  const render = (row) =>
    row
      .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column])))
      .join('  ')
      .trimEnd();
  lines.push(render(header), ...rows.map(render));
  if (report.escalation.required) {
    lines.push(`escalation: ${report.escalation.message}`);
    for (const reason of report.escalation.reasons) lines.push(`  - ${reason.path} [${reason.rule}] ${reason.why}`);
  }
  lines.push(`partial: ${report.partial}${report.partial ? ` (${report.partialReasons.join('; ')})` : ''}`);
  for (const hint of report.hints) lines.push(`hint: ${hint}`);
  if (report.provisioned?.databases?.length)
    lines.push(
      `provisioned databases (left in place; drop them yourself when done): ${report.provisioned.databases.join(', ')}`,
    );
  return lines.join('\n');
}

export function reportFileName(tier, startedAt) {
  return `${startedAt
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')}-${tier}.json`;
}

// ---- CLI ---------------------------------------------------------------------------------------------------------

export const USAGE = `Usage: node scripts/gate.mjs --tier quick|light|full [options] [-- <playwright args>]
  --base <ref>        compare with this commit (default: merge-base with origin/main, else HEAD~1; env GATE_BASE)
  --keep-going        run every step even after a failure (default: stop at the first failure)
  --dry-run           show the change set, escalation and planned steps/suites without running checks
  --with-smoke        light only: also run the @smoke browser tests (needs servers, or --provision)
  --without-browser   full only: skip browser and identity suites; the report says partial: true
  --provision         full, or light --with-smoke: create NEW uniquely named empty loopback databases, prepare the
                      fixtures, start compiled API + Web on free ports, run Playwright, stop only what it started
Reports: stdout table and .runtime/gate/<UTC>-<tier>.json. See docs/specs/test-tiers.md.`;

export function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        tier: { type: 'string' },
        base: { type: 'string' },
        'keep-going': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        'with-smoke': { type: 'boolean', default: false },
        'without-browser': { type: 'boolean', default: false },
        provision: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error) {
    throw new GateUsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (values.help) return { help: true };
  const tier = values.tier;
  if (!TIERS.includes(tier)) throw new GateUsageError(`--tier must be one of: ${TIERS.join(', ')}`);
  if (values['with-smoke'] && tier !== 'light')
    throw new GateUsageError('--with-smoke applies to the light tier only.');
  if (values['without-browser'] && tier !== 'full')
    throw new GateUsageError('--without-browser applies to the full tier only.');
  if (values.provision && values['without-browser'])
    throw new GateUsageError('--provision and --without-browser cannot be combined.');
  const browserTier = (tier === 'full' && !values['without-browser']) || (tier === 'light' && values['with-smoke']);
  if (values.provision && !browserTier)
    throw new GateUsageError('--provision applies to full, or to light with --with-smoke.');
  if (positionals.length && !browserTier)
    throw new GateUsageError('Extra arguments are passed to Playwright and need full or light --with-smoke.');
  return {
    help: false,
    tier,
    base: values.base,
    keepGoing: values['keep-going'],
    dryRun: values['dry-run'],
    withSmoke: values['with-smoke'],
    withoutBrowser: values['without-browser'],
    provision: values.provision,
    playwrightArgs: positionals,
  };
}

// ---- runner (process work) -----------------------------------------------------------------------------------------

export function gitRunner(cwd = ROOT) {
  return (args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
}

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function spawnTarget(command) {
  if (command.program === 'node') return [process.execPath, command.args];
  const cli = process.env.npm_execpath;
  if (cli && /pnpm/i.test(basename(cli)))
    return /\.[cm]?js$/.test(cli) ? [process.execPath, [cli, ...command.args]] : [cli, command.args];
  return ['pnpm', command.args];
}

// Environment for child steps: the identity fixture reads TEST_DATABASE_URL_* for its own database, so the gate
// passes per-step values and keeps the DB-test variables away from browser fixtures.
function scrubbedEnv(env, keep = []) {
  const out = { ...env };
  for (const name of Object.keys(out))
    if (
      !keep.includes(name) &&
      (/^(TEST_)?DATABASE_URL(_OWNER)?$/.test(name) || /^GATE_IDENTITY_/.test(name) || /^E2E_/.test(name))
    )
      delete out[name];
  return out;
}

function tokyoDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
}

export function provisionDatabaseName(kind, now = new Date(), random = randomBytes(3).toString('hex')) {
  const suffix = `g${now.toISOString().replace(/\D/g, '').slice(0, 14)}${random}`;
  return kind === 'identity' ? `daifuku_e2e_test_enterprise_${suffix}` : `daifuku_e2e_test_${suffix}`;
}

export function databaseUrl(url, name) {
  const copy = new URL(url.href);
  copy.pathname = `/${name}`;
  return copy.href;
}

async function createDatabase(ownerUrl, name, pattern) {
  if (!pattern.test(name) || !/^[a-z0-9_]{1,63}$/.test(name)) throw new Error(`refusing unsafe database name ${name}`);
  const postgres = createRequire(new URL('../apps/api/package.json', import.meta.url))('postgres');
  const sql = postgres(ownerUrl.href, { max: 1, onnotice: () => undefined });
  try {
    // A NEW database only; an existing name fails and nothing is dropped or reset.
    await sql.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await sql.end();
  }
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

async function reachable(url) {
  try {
    const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

// Runner state for one invocation: started process groups, provisioned databases and the browser environment.
export function createSession(runDir) {
  const children = [];
  const alive = (child) => {
    if (!child.pid) return false;
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const signal = (child, name) => {
    try {
      if (child.pid) process.kill(-child.pid, name);
    } catch {
      /* group already exited */
    }
  };
  const sleep = (ms) => new Promise((done) => globalThis.setTimeout(done, ms));
  return {
    runDir,
    children,
    databases: [],
    ports: {},
    browserEnv: null,
    current: null,
    interrupted: null,
    startDetached(target, args, options, logName) {
      mkdirSync(runDir, { recursive: true });
      const log = openSync(join(runDir, logName), 'a');
      const child = spawn(target, args, { ...options, stdio: ['ignore', log, log], detached: true });
      closeSync(log);
      children.push(child);
      return child;
    },
    // Stops only the process groups this run started.
    async stop() {
      for (const child of [...children].reverse()) {
        if (!alive(child)) continue;
        signal(child, 'SIGTERM');
        const deadline = Date.now() + 5000;
        while (alive(child) && Date.now() < deadline) await sleep(50);
        if (alive(child)) signal(child, 'SIGKILL');
      }
    },
  };
}

function runCommand(command, env, session, { log } = {}) {
  return new Promise((done) => {
    const [target, args] = spawnTarget(command);
    let stdio = 'inherit';
    let fd = null;
    if (log) {
      mkdirSync(dirname(log), { recursive: true });
      fd = openSync(log, 'a');
      stdio = ['ignore', fd, fd];
    }
    const child = spawn(target, args, { cwd: ROOT, env, stdio });
    if (fd !== null) closeSync(fd);
    session.current = child;
    child.once('error', (error) => done({ ok: false, reason: error.message }));
    child.once('exit', (code, signal) => {
      session.current = null;
      done({
        ok: code === 0 && !session.interrupted,
        interrupted: Boolean(session.interrupted),
        reason: code === 0 ? null : `exit ${code ?? signal}`,
      });
    });
  });
}

async function waitReady(urls, children, session, seconds = 120) {
  for (let attempt = 0; attempt < seconds * 2; attempt++) {
    if (session.interrupted) throw new Error('interrupted while waiting for fixture servers');
    if (children.some((child) => child.exitCode !== null || child.signalCode !== null))
      throw new Error('a fixture server exited before readiness; see its log in the run directory');
    if ((await Promise.all(urls.map(reachable))).every(Boolean)) return;
    await new Promise((done) => globalThis.setTimeout(done, 500));
  }
  throw new Error('fixture servers did not become ready within 120 seconds');
}

// --provision: NEW empty fixture database, fixture preparation, compiled API + Web on free loopback ports.
export async function prepareBrowserFixture(session) {
  const targets = provisionTargets(process.env);
  if (!targets) throw new Error(GUIDANCE.provision);
  const name = provisionDatabaseName('e2e');
  await createDatabase(targets.owner, name, E2E_DATABASE_NAME);
  session.databases.push(name);
  const fixtureEnv = {
    ...scrubbedEnv(process.env),
    DATABASE_URL_OWNER: databaseUrl(targets.owner, name),
    DATABASE_URL: databaseUrl(targets.app, name),
    E2E_PREPARE: '1',
    E2E_INVOICE_DATE: tokyoDate(),
    TZ: 'Asia/Tokyo',
    DAIFUKU_PACKS: 'all',
  };
  const fixture = await runCommand(
    pnpm('--filter', APP_PACKAGES.api, 'exec', 'tsx', 'src/db/e2e-fixture.ts'),
    fixtureEnv,
    session,
    { log: join(session.runDir, 'fixture.log') },
  );
  if (!fixture.ok) throw new Error(`fixture preparation failed (${join(session.runDir, 'fixture.log')})`);
  const main = join(ROOT, '.runtime/api/apps/api/dist/main.js');
  if (!existsSync(main)) throw new Error('compiled API is missing; run pnpm build:api first');
  const api = await freePort();
  const web = await freePort();
  session.ports = { api, web };
  const apiChild = session.startDetached(
    process.execPath,
    [main],
    {
      cwd: join(ROOT, 'apps/api'),
      env: {
        ...fixtureEnv,
        JWT_SECRET: SYNTHETIC_JWT_SECRET,
        HOST: '127.0.0.1',
        PORT: String(api),
        CORS_ORIGINS: `http://localhost:${web}`,
        DAIFUKU_STORAGE_DIR: join(session.runDir, 'evidence'),
      },
    },
    'api.log',
  );
  const [webTarget, webArgs] = spawnTarget(
    pnpm('--filter', APP_PACKAGES.web, 'exec', 'vite', '--host', '127.0.0.1', '--port', String(web), '--strictPort'),
  );
  const webChild = session.startDetached(
    webTarget,
    webArgs,
    { cwd: ROOT, env: { ...scrubbedEnv(process.env), VITE_API_URL: `http://localhost:${api}` } },
    'web.log',
  );
  await waitReady([`http://127.0.0.1:${api}/health`, `http://127.0.0.1:${web}/`], [apiChild, webChild], session);
  session.browserEnv = {
    ...fixtureEnv,
    VITE_API_URL: `http://localhost:${api}`,
    E2E_API_URL: `http://localhost:${api}`,
    E2E_BASE_URL: `http://localhost:${web}`,
    DAIFUKU_STORAGE_DIR: join(session.runDir, 'evidence'),
  };
  return { ok: true };
}

async function identityEnv(session) {
  if (!session.provision)
    return {
      ...scrubbedEnv(process.env),
      TEST_DATABASE_URL_OWNER: process.env.GATE_IDENTITY_DATABASE_URL_OWNER,
      TEST_DATABASE_URL: process.env.GATE_IDENTITY_DATABASE_URL,
      E2E_IDENTITY_PREPARE: '1',
    };
  const targets = provisionTargets(process.env);
  if (!targets) throw new Error(GUIDANCE.provision);
  const name = provisionDatabaseName('identity');
  await createDatabase(targets.owner, name, IDENTITY_DATABASE_NAME);
  session.databases.push(name);
  return {
    ...scrubbedEnv(process.env),
    TEST_DATABASE_URL_OWNER: databaseUrl(targets.owner, name),
    TEST_DATABASE_URL: databaseUrl(targets.app, name),
    E2E_IDENTITY_PREPARE: '1',
  };
}

async function executeStep(item, session) {
  if (item.special === 'browser:prepare') return await prepareBrowserFixture(session);
  if (item.special === 'identity') return await runCommand(item.command, await identityEnv(session), session);
  if (item.special === 'browser' || item.special === 'smoke')
    return await runCommand(item.command, session.browserEnv ?? process.env, session);
  return await runCommand(item.command, process.env, session);
}

function selectTests(selection, session) {
  const output = join(session.runDir, `select-${selection.project}.json`);
  mkdirSync(session.runDir, { recursive: true });
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts/gate-select.mjs')], {
    cwd: ROOT,
    input: JSON.stringify({ ...selection, output }),
    stdio: ['pipe', 'inherit', 'inherit'],
    env: process.env,
  });
  if (result.status !== 0) throw new Error(`test selection for ${selection.project} failed`);
  return JSON.parse(readFileSync(output, 'utf8'));
}

function resolveSelection(item, session) {
  return item.selection ? applySelection(item, selectTests(item.selection, session)) : item;
}

async function main(argv) {
  let options;
  try {
    options = parseCli(argv);
  } catch (error) {
    if (!(error instanceof GateUsageError)) throw error;
    console.error(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const startedAt = new Date();
  const git = gitRunner(ROOT);
  let base;
  try {
    base = resolveBase({ explicit: options.base, env: process.env, git });
  } catch (error) {
    if (!(error instanceof GateUsageError)) throw error;
    console.error(error.message);
    return 2;
  }
  const head = git(['rev-parse', '--verify', '--quiet', 'HEAD']).stdout.trim() || null;
  const changes = collectChangeSet({ base, git, exists: (path) => pathExists(join(ROOT, path)) });
  const cls = classifyChanges(changes, loadWorkspacePackages(ROOT));
  const escalation = detectEscalation(changes);
  const gateScripts = parseGateScript(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.gate);
  const runDir = join(ROOT, '.runtime/gate', reportFileName(options.tier, startedAt).replace(/\.json$/, ''));
  const session = { ...createSession(runDir), provision: options.provision };
  let steps = planSteps({ tier: options.tier, cls, base, escalation, options, gateScripts });
  const needsReach = steps.some((item) => ['browser', 'smoke'].includes(item.special)) && !options.provision;
  const reach = needsReach
    ? {
        api: Boolean(process.env.E2E_API_URL) && (await reachable(`${process.env.E2E_API_URL}/health`)),
        web: Boolean(process.env.E2E_BASE_URL) && (await reachable(process.env.E2E_BASE_URL)),
      }
    : {};
  steps = applyPreflight(steps, { env: process.env, options, reach });
  const finish = (results, result) => {
    const report = buildReport({
      tier: options.tier,
      options,
      base,
      head,
      changes,
      cls,
      escalation,
      steps: results,
      startedAt,
      finishedAt: new Date(),
      result,
      provisioned: session.databases.length ? { databases: session.databases, ports: session.ports } : null,
    });
    const directory = join(ROOT, '.runtime/gate');
    mkdirSync(directory, { recursive: true });
    const file = join(directory, reportFileName(options.tier, startedAt));
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\n${formatTable(report)}\nreport: ${posix.join('.runtime/gate', basename(file))}`);
    for (const item of results.filter((entry) => entry.blocked && ['failed', 'blocked'].includes(entry.result)))
      console.error(`\n[${item.id}] ${item.blocked}`);
    return report;
  };
  if (options.tier === 'quick' && !changes.length) {
    console.log('gate:quick: no changes since the base; nothing to check.');
    finish([], 'no-changes');
    return 0;
  }
  if (options.dryRun) {
    const planned = steps.map((item) => {
      const resolved = item.blocked || item.skip ? item : resolveSelection(item, session);
      return {
        ...resolved,
        result: resolved.skip?.result ?? (resolved.blocked ? 'blocked' : 'planned'),
        reason: resolved.skip?.reason ?? resolved.blocked ?? null,
      };
    });
    for (const item of planned.filter((entry) => entry.selectedFiles?.length))
      console.log(`\n${item.id} would run ${item.selectedFiles.length} files:\n  ${item.selectedFiles.join('\n  ')}`);
    finish(planned, 'dry-run');
    return 0;
  }
  const onSignal = (name, code) => () => {
    session.interrupted = code;
    session.current?.kill(name);
  };
  const handlers = [
    ['SIGINT', onSignal('SIGINT', 130)],
    ['SIGTERM', onSignal('SIGTERM', 143)],
  ];
  for (const [name, handler] of handlers) process.on(name, handler);
  let outcome;
  try {
    outcome = await runSteps(steps, {
      keepGoing: options.keepGoing,
      now: () => globalThis.performance.now() / 1000,
      prepare: async (item) => {
        console.log(`\n==> gate:${options.tier} ${item.id}${item.command ? `: ${commandText(item.command)}` : ''}`);
        const resolved = resolveSelection(item, session);
        if (resolved !== item && resolved.command)
          console.log(`    selected ${selectionText(resolved.selected)}: ${commandSummary(resolved.command)}`);
        return resolved;
      },
      execute: async (item) => {
        const result = await executeStep(item, session);
        return session.interrupted ? { ...result, ok: false, interrupted: true } : result;
      },
    });
  } finally {
    await session.stop();
    for (const [name, handler] of handlers) process.off(name, handler);
  }
  finish(outcome.steps, outcome.interrupted ? 'interrupted' : outcome.ok ? 'passed' : 'failed');
  if (session.interrupted) return session.interrupted;
  return outcome.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`gate failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
