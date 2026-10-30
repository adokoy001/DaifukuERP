#!/usr/bin/env node
// Pack scaffold generator (docs/specs/pack-scaffold.md): `node scripts/pack-new.mjs <name>` creates packs/<name> and
// docs/specs/pack-<name>.md from scripts/pack-template (package.json and tsconfig.json from packs/example), prints the
// remaining steps in order, and with --register applies the four registration edits. Every check and every output is
// computed before the first write; writes go through a staging directory and are rolled back on failure or signal.
// Pure planning functions are exported for scripts/test/pack-new.test.ts and pack-new.db.test.ts.
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import * as prettier from 'prettier';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'pack-template');
export const NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const NAME_MIN = 2;
export const NAME_MAX = 24;
export const LABEL_MAX = 40;
// pack: kernel-reserved; packs/company: kernel company-setting namespaces (packs.applied, company.profile);
// all/none: special DAIFUKU_PACKS values; kernel: layer name; constructor/missing: unknown names in runtime.test.ts AC-2.
export const RESERVED_NAMES = Object.freeze([
  'pack',
  'packs',
  'all',
  'none',
  'kernel',
  'company',
  'constructor',
  'missing',
]);
// Directories scanned for declared module/pack/entity names (AC-10) and for partner ext keys (no apps/).
export const DECLARATION_DIRS = Object.freeze(['kernel', 'modules', 'l10n', 'packs', 'apps']);
export const EXT_KEY_DIRS = Object.freeze(['kernel', 'modules', 'l10n', 'packs']);
export const STAGING_DIR = 'node_modules/.cache/pack-new';
export const REGISTER_FILES = Object.freeze({
  catalog: 'apps/runtime/src/packs.ts',
  runtimePackage: 'apps/runtime/package.json',
  runtimeTest: 'apps/runtime/test/runtime.test.ts',
  workforceSpec: 'apps/web/e2e/workforce.spec.ts',
});
export const CATALOG_TEST_MARKER = 'expect(schema.packs).toEqual([';
export const TEMPLATE_COUNT_PATTERN = /利用できる業界テンプレート (\d+) 種/g;
// Template file (relative to TEMPLATE_DIR) -> output path builder.
export const TEMPLATE_FILES = Object.freeze([
  ['src/index.ts.tmpl', (n) => `${n.dir}/src/index.ts`],
  ['src/pack.ts.tmpl', (n) => `${n.dir}/src/pack.ts`],
  ['src/entities/tag.ts.tmpl', (n) => n.entityFile],
  ['src/actions/count-tags.ts.tmpl', (n) => `${n.dir}/src/actions/count-tags.ts`],
  ['src/seed.ts.tmpl', (n) => `${n.dir}/src/seed.ts`],
  ['src/sample.ts.tmpl', (n) => `${n.dir}/src/sample.ts`],
  ['test/pack.db.test.ts.tmpl', (n) => `${n.dir}/test/pack.db.test.ts`],
  ['spec.md.tmpl', (n) => n.spec],
]);
const PLACEHOLDER = /__PACK_([A-Z]+(?:_[A-Z]+)*)__/g;
const LABEL_FORBIDDEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;
const MARKDOWN_SPECIAL = /[\\`*_[\]<>|#]/g;

export const USAGE = `Usage: node scripts/pack-new.mjs <name> [options]

Creates packs/<name> (a minimal pack with a partner ext field, a small master, a read-only action, seed, sample and
its DB test) and docs/specs/pack-<name>.md, then prints the remaining steps. <name> is kebab-case, 2-24 characters
(e.g. bike-shop -> pack bike_shop, package @daifuku/pack-bike-shop).

Options:
  --register          also apply the registration edits (apps/runtime/src/packs.ts, apps/runtime/package.json,
                      apps/runtime/test/runtime.test.ts, apps/web/e2e/workforce.spec.ts)
  --dry-run           print the files, edits and steps without writing anything
  --label-ja <text>   Japanese pack label (default: the English label, with a warning)
  --label-en <text>   English pack label (default: the name in title case, e.g. "Bike Shop")
  --help              print this help

Details: docs/conventions/packs.md ("雛形から始める") and docs/specs/pack-scaffold.md.
`;

export class PackNewUsageError extends Error {}
export class PackNewError extends Error {
  constructor(message, problems = []) {
    super(message);
    this.problems = problems;
  }
}
export class PackNewInterrupted extends Error {
  constructor(signal) {
    super(`interrupted by ${signal}`);
    this.signal = signal;
  }
}

// ---- arguments and names ---------------------------------------------------------------------------------------------

export function parsePackNewArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        register: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        'label-ja': { type: 'string' },
        'label-en': { type: 'string' },
        root: { type: 'string' },
        help: { type: 'boolean' },
      },
    });
  } catch (error) {
    throw new PackNewUsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (values.help) return { help: true };
  if (positionals.length === 0) throw new PackNewUsageError('Missing <name>.');
  if (positionals.length > 1) throw new PackNewUsageError(`Expected one <name>, got ${positionals.length}.`);
  const args = {
    help: false,
    name: positionals[0],
    register: Boolean(values.register),
    dryRun: Boolean(values['dry-run']),
    root: values.root === undefined ? ROOT : resolve(values.root),
  };
  if (values['label-ja'] !== undefined) args.labelJa = values['label-ja'];
  if (values['label-en'] !== undefined) args.labelEn = values['label-en'];
  return args;
}

const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);

export function packNames(kebab) {
  const words = kebab.split('-');
  const snake = words.join('_');
  const pascal = words.map(capitalize).join('');
  const camel = (words[0] ?? '') + words.slice(1).map(capitalize).join('');
  const code = snake.replaceAll('_', '').toUpperCase().slice(0, 12);
  const dir = `packs/${kebab}`;
  return {
    kebab,
    snake,
    pascal,
    camel,
    code,
    dir,
    packageName: `@daifuku/pack-${kebab}`,
    packExport: `${pascal}Pack`,
    entity: `${snake}_tag`,
    entityExport: `${pascal}Tag`,
    entityFile: `${dir}/src/entities/${kebab}-tag.ts`,
    action: `${snake}.count_tags`,
    extKey: `${camel}Note`,
    sampleCode: `${code}-0001`,
    spec: `docs/specs/pack-${kebab}.md`,
    migration: `pack_${snake}`,
  };
}

function suggestName(name) {
  const suggestion = String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '')
    .slice(0, NAME_MAX)
    .replace(/-+$/, '');
  return NAME_PATTERN.test(suggestion) && suggestion.length >= NAME_MIN && !RESERVED_NAMES.includes(suggestion)
    ? suggestion
    : null;
}

export function validatePackName(name) {
  const problems = [];
  if (typeof name !== 'string' || name === '') return ['<name> is required.'];
  const example = suggestName(name);
  const hint = example && example !== name ? ` (e.g. ${name} -> ${example})` : ' (e.g. bike-shop)';
  if (!NAME_PATTERN.test(name))
    problems.push(
      `<name> must be kebab-case: lowercase ASCII letters and digits in words joined by single hyphens, starting with a letter${hint}.`,
    );
  if (name.length < NAME_MIN || name.length > NAME_MAX)
    problems.push(`<name> must be ${NAME_MIN}-${NAME_MAX} characters long (got ${name.length})${hint}.`);
  if (RESERVED_NAMES.includes(name))
    problems.push(`<name> "${name}" is reserved (${RESERVED_NAMES.join(', ')}); choose a more specific name.`);
  return problems;
}

export function validateLabel(text, option) {
  const problems = [];
  const length = [...text].length;
  if (length < 1 || length > LABEL_MAX)
    problems.push(`${option} must be 1-${LABEL_MAX} characters long (got ${length}).`);
  if (text !== text.trim()) problems.push(`${option} must not start or end with whitespace.`);
  if (LABEL_FORBIDDEN.test(text))
    problems.push(`${option} must not contain control, format, line/paragraph separator or lone surrogate characters.`);
  if (text.includes('__PACK_'))
    problems.push(`${option} must not contain "__PACK_" (the template placeholder prefix).`);
  return problems;
}

export function defaultLabels(names, given = {}) {
  const en = given.labelEn ?? names.kebab.split('-').map(capitalize).join(' ');
  const jaDefaulted = given.labelJa === undefined;
  const ja = given.labelJa ?? en;
  const warnings = jaDefaulted
    ? [
        `warning: --label-ja was not given; the Japanese label is "${en}". Set a Japanese name in ${names.dir}/src/pack.ts and the spec.`,
      ]
    : [];
  return { ja, en, jaDefaulted, warnings };
}

// ---- collisions (AC-10): static scan, never writes --------------------------------------------------------------------

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function readTextOrNull(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function listDir(path) {
  try {
    return readdirSync(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function* sourceFiles(dir) {
  for (const entry of listDir(dir)) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name)) yield path;
  }
}

function declaredNames(text, functions) {
  const pattern = new RegExp(
    `\\b(?:${functions.join('|')})\\(\\s*\\{[\\s\\S]{0,400}?\\bname:\\s*['"\`]([^'"\`]+)['"\`]`,
    'g',
  );
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

function workspacePackageNames(root) {
  const names = new Map();
  const dirs = ['kernel'];
  for (const group of ['modules', 'l10n', 'packs', 'apps'])
    for (const entry of listDir(join(root, group))) if (entry.isDirectory()) dirs.push(`${group}/${entry.name}`);
  for (const dir of dirs) {
    const text = readTextOrNull(join(root, dir, 'package.json'));
    if (text === null) continue;
    try {
      const name = JSON.parse(text).name;
      if (typeof name === 'string') names.set(name, `${dir}/package.json`);
    } catch {
      /* an unreadable package.json is not a collision */
    }
  }
  return names;
}

export function catalogKeys(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^\s*(export\s+)?const AVAILABLE\b/.test(line));
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && line === '};');
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .map((line) => /^\s*([a-z][a-z0-9_]*)\s*:/.exec(line)?.[1])
    .filter(Boolean);
}

export function stagingLeftovers(root) {
  return listDir(join(root, STAGING_DIR)).map((entry) => `${STAGING_DIR}/${entry.name}`);
}

export function findCollisions(root, names) {
  const problems = [];
  const at = (path) => relative(root, path).split(sep).join('/');
  if (lstatOrNull(join(root, names.dir))) problems.push(`${names.dir} already exists.`);
  const owner = workspacePackageNames(root).get(names.packageName);
  if (owner) problems.push(`${names.packageName} is already the name of ${owner}.`);
  const sameCamel = listDir(join(root, 'packs'))
    .map((entry) => entry.name)
    .filter((dir) => dir !== names.kebab && NAME_PATTERN.test(dir) && packNames(dir).camel === names.camel);
  for (const dir of sameCamel)
    problems.push(
      `packs/${dir} derives the same identifiers (${names.pascal}Pack, ${names.extKey}); choose another name.`,
    );
  const extKey = new RegExp(`(?:^|[\\s{,])['"]?${names.extKey}['"]?\\??\\s*:`, 'm');
  for (const top of DECLARATION_DIRS) {
    for (const file of sourceFiles(join(root, top))) {
      const text = readTextOrNull(file) ?? '';
      if (declaredNames(text, ['defineModule', 'definePack']).includes(names.snake))
        problems.push(`module/pack "${names.snake}" is already declared in ${at(file)}.`);
      for (const entity of declaredNames(text, ['defineEntity', 'defineDocument']))
        if (entity === names.snake || entity === names.entity)
          problems.push(`entity "${entity}" is already declared in ${at(file)}.`);
      if (EXT_KEY_DIRS.includes(top) && extKey.test(text))
        problems.push(`ext key "${names.extKey}" already appears in ${at(file)}.`);
    }
  }
  const catalog = readTextOrNull(join(root, REGISTER_FILES.catalog));
  if (catalog !== null && catalogKeys(catalog).includes(names.snake))
    problems.push(`"${names.snake}" is already a key of AVAILABLE in ${REGISTER_FILES.catalog}.`);
  if (lstatOrNull(join(root, names.spec))) problems.push(`${names.spec} already exists.`);
  const warnings = stagingLeftovers(root).map(
    (path) => `warning: ${path} was left by an interrupted run; remove it when no pack-new is running.`,
  );
  return { problems: [...new Set(problems)], warnings };
}

// ---- rendering ------------------------------------------------------------------------------------------------------

export function escapeMarkdown(text) {
  return text.replace(MARKDOWN_SPECIAL, (char) => `\\${char}`);
}

function labelValues(labels) {
  return {
    LABEL_JA: labels.ja,
    LABEL_EN: labels.en,
    TAG_LABEL_JA: `${labels.ja}のタグ`,
    TAG_LABEL_EN: `${labels.en} tags`,
    NOTE_LABEL_JA: `${labels.ja}の備考`,
    NOTE_LABEL_EN: `${labels.en} note`,
  };
}

function placeholderValues(names, labels, today, markdown) {
  const derived = labelValues(labels);
  const values = {
    KEBAB: names.kebab,
    SNAKE: names.snake,
    PASCAL: names.pascal,
    CAMEL: names.camel,
    CODE: names.code,
    DATE: today,
  };
  for (const [key, value] of Object.entries(derived))
    values[key] = markdown ? escapeMarkdown(value) : JSON.stringify(value);
  values.LABEL_TODO =
    markdown && labels.jaDefaulted
      ? `TODO: 日本語ラベルを決める（生成時に \`--label-ja\` が無かったため、日本語ラベルは英語ラベル「${escapeMarkdown(labels.en)}」と同じ。\`src/pack.ts\` と \`src/entities/\` のラベルとこの spec を直す）。`
      : '';
  return values;
}

export function renderTemplate(template, values, source = 'template') {
  const lines = template.split('\n').filter((line) => {
    const only = /^__PACK_([A-Z]+(?:_[A-Z]+)*)__$/.exec(line);
    return !(only && values[only[1]] === '');
  });
  return lines.join('\n').replace(PLACEHOLDER, (match, key) => {
    if (!Object.hasOwn(values, key)) throw new PackNewError(`${source}: unknown placeholder ${match}`);
    return values[key];
  });
}

async function formatTs(root, path, text) {
  const options = JSON.parse(readFileSync(join(root, '.prettierrc.json'), 'utf8'));
  return prettier.format(text, { ...options, filepath: join(root, path) });
}

function packageJsonFor(root, names) {
  const example = JSON.parse(readFileSync(join(root, 'packs/example/package.json'), 'utf8'));
  const pick = (source, keys, label) => {
    const out = {};
    for (const key of Object.keys(source ?? {})) if (keys.includes(key)) out[key] = source[key];
    const missing = keys.filter((key) => !Object.hasOwn(out, key));
    if (missing.length) throw new PackNewError(`packs/example/package.json has no ${label} ${missing.join(', ')}`);
    return out;
  };
  const pkg = {
    name: names.packageName,
    version: '0.0.1',
    private: example.private,
    type: example.type,
    exports: example.exports,
    scripts: pick(example.scripts, ['typecheck'], 'script'),
    devDependencies: pick(example.devDependencies, ['@types/node', 'typescript', 'vitest'], 'devDependency'),
    dependencies: pick(example.dependencies, ['@daifuku/kernel', 'zod', '@daifuku/mod-partner'], 'dependency'),
  };
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

// ---- registration edits (AC-7, AC-11) --------------------------------------------------------------------------------

export function registrationLines(names, count) {
  return {
    catalog: `${names.snake}: async () => (await import('${names.packageName}')).${names.packExport},`,
    runtimePackage: `"${names.packageName}": "workspace:*"`,
    runtimeTest: `'${names.snake}',`,
    workforceSpec:
      count === null
        ? `change the number in '利用できる業界テンプレート <N> 種' to <N+1>`
        : `'利用できる業界テンプレート ${count} 種' -> '利用できる業界テンプレート ${count + 1} 種'`,
  };
}

function editProblem(path, reason, line) {
  return `${path}: ${reason}. Register by hand: ${line}`;
}

function catalogEdit(text, names, line) {
  const path = REGISTER_FILES.catalog;
  const lines = text.split('\n');
  const starts = lines.flatMap((current, index) => (/^\s*(export\s+)?const AVAILABLE\b/.test(current) ? [index] : []));
  if (starts.length !== 1)
    return { problem: editProblem(path, `\`const AVAILABLE\` found ${starts.length} times (expected 1)`, line) };
  const start = starts[0];
  const end = lines.findIndex((current, index) => index > start && current === '};');
  if (end < 0) return { problem: editProblem(path, 'the closing `};` of AVAILABLE was not found', line) };
  const block = lines.slice(start, end).join('\n');
  if (block.includes(`'${names.packageName}'`) || catalogKeys(text).includes(names.snake))
    return { problem: editProblem(path, `${names.snake} is already in AVAILABLE`, line) };
  lines.splice(end, 0, `  ${line}`);
  return { after: lines.join('\n') };
}

function runtimePackageEdit(text, names, line) {
  const path = REGISTER_FILES.runtimePackage;
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch (error) {
    return { problem: editProblem(path, `not valid JSON (${error.message})`, line) };
  }
  if (`${JSON.stringify(pkg, null, 2)}\n` !== text)
    return {
      problem: editProblem(path, 'not 2-space JSON with a final newline; writing it back would reformat it', line),
    };
  if (!pkg.dependencies || typeof pkg.dependencies !== 'object' || Array.isArray(pkg.dependencies))
    return { problem: editProblem(path, 'has no "dependencies" object', line) };
  if (Object.hasOwn(pkg.dependencies, names.packageName))
    return { problem: editProblem(path, `already depends on ${names.packageName}`, line) };
  pkg.dependencies[names.packageName] = 'workspace:*';
  return { after: `${JSON.stringify(pkg, null, 2)}\n` };
}

function runtimeTestEdit(text, names, line) {
  const path = REGISTER_FILES.runtimeTest;
  const lines = text.split('\n');
  const starts = lines.flatMap((current, index) => (current.includes(CATALOG_TEST_MARKER) ? [index] : []));
  if (starts.length !== 1)
    return { problem: editProblem(path, `\`${CATALOG_TEST_MARKER}\` found ${starts.length} times (expected 1)`, line) };
  const start = starts[0];
  if (!lines[start].trimEnd().endsWith(CATALOG_TEST_MARKER))
    return { problem: editProblem(path, 'the expected catalog array is not one entry per line', line) };
  const end = lines.findIndex((current, index) => index > start && /^\s*\]\);\s*$/.test(current));
  if (end < 0) return { problem: editProblem(path, 'the end `]);` of the expected catalog array was not found', line) };
  const entries = lines.slice(start + 1, end).map((current) => current.trim());
  if (entries.includes(`'${names.snake}',`) || entries.includes(`'${names.snake}'`))
    return { problem: editProblem(path, `'${names.snake}' is already in the expected catalog`, line) };
  const indent = /^\s*/.exec(lines[end - 1] ?? '')?.[0] ?? '      ';
  lines.splice(end, 0, `${indent}${line}`);
  return { after: lines.join('\n') };
}

function templateCount(text) {
  const matches = [...text.matchAll(TEMPLATE_COUNT_PATTERN)];
  return matches.length === 1 ? Number(matches[0][1]) : null;
}

function workforceSpecEdit(text, line) {
  const path = REGISTER_FILES.workforceSpec;
  const found = [...text.matchAll(TEMPLATE_COUNT_PATTERN)].length;
  if (found !== 1)
    return {
      problem: editProblem(path, `'利用できる業界テンプレート <N> 種' found ${found} times (expected 1)`, line),
    };
  return {
    after: text.replace(
      TEMPLATE_COUNT_PATTERN,
      (_match, count) => `利用できる業界テンプレート ${Number(count) + 1} 種`,
    ),
  };
}

async function planEdits(root, names) {
  const problems = [];
  const edits = [];
  const count = templateCount(readTextOrNull(join(root, REGISTER_FILES.workforceSpec)) ?? '');
  const lines = registrationLines(names, count);
  const builders = [
    ['catalog', (text) => catalogEdit(text, names, lines.catalog)],
    ['runtimePackage', (text) => runtimePackageEdit(text, names, lines.runtimePackage)],
    ['runtimeTest', (text) => runtimeTestEdit(text, names, lines.runtimeTest)],
    ['workforceSpec', (text) => workforceSpecEdit(text, lines.workforceSpec)],
  ];
  for (const [key, build] of builders) {
    const path = REGISTER_FILES[key];
    const before = readTextOrNull(join(root, path));
    if (before === null) {
      problems.push(editProblem(path, 'file not found', lines[key]));
      continue;
    }
    const result = build(before);
    if (result.problem) {
      problems.push(result.problem);
      continue;
    }
    let after = result.after;
    if (path.endsWith('.ts')) {
      try {
        after = await formatTs(root, path, after);
      } catch (error) {
        problems.push(editProblem(path, `the edited file does not format (${error.message})`, lines[key]));
        continue;
      }
    }
    edits.push({ path, before, after });
  }
  if (problems.length) throw new PackNewError('Cannot apply the registration edits (nothing was written).', problems);
  return edits;
}

// ---- steps (AC-6) -----------------------------------------------------------------------------------------------------

export function nextSteps(names, { register, count = null }) {
  const lines = registrationLines(names, count);
  const registration = register
    ? [`1. Register: done (--register edited ${Object.values(REGISTER_FILES).join(', ')}).`]
    : [
        '1. Register the pack (or run again with --register). To try it unregistered first, skip this step; when you register later, run step 2 again.',
        `   a. ${REGISTER_FILES.catalog}, as the last entry of AVAILABLE:`,
        `        ${lines.catalog}`,
        `   b. ${REGISTER_FILES.runtimePackage}, at the end of "dependencies":`,
        `        ${lines.runtimePackage}`,
        `   c. ${REGISTER_FILES.runtimeTest}, at the end of the array after \`${CATALOG_TEST_MARKER}\`:`,
        `        ${lines.runtimeTest}`,
        `   d. ${REGISTER_FILES.workforceSpec} (the /templates count of every pack except example):`,
        `        ${lines.workforceSpec}`,
      ];
  return [
    ...registration,
    '2. pnpm install   # links the new workspace package and updates pnpm-lock.yaml. Run it after editing apps/runtime/package.json: the runtime catalog imports the pack only through that dependency.',
    `3. pnpm db:generate ${names.migration}   # after registering: the migration for the ${names.entity} table (if the number collides at integration, the integrator regenerates it).`,
    `4. pnpm --filter ${names.packageName} typecheck`,
    `   pnpm exec vitest run --project db ${names.dir}/test/pack.db.test.ts   # needs TEST_DATABASE_URL_OWNER and TEST_DATABASE_URL`,
    '5. pnpm gate:light   # the new package.json widens light to every DB suite.',
    `6. Optional: add ${names.snake} to DAIFUKU_PACKS in .env if you narrowed it; describe the pack in apps/web/src/lib/templates.ts; map module ${names.snake} to a workspace in apps/web/src/lib/navigation-data.ts (otherwise its menu shows under "Other"); update docs/manual when users get new steps; write the work log in docs/log/; fill in the TODO: items of ${names.spec}.`,
    `7. Apply: pnpm pack:apply ${names.snake} --sample, or the /templates screen.`,
  ];
}

// ---- plan (pure: reads only) -------------------------------------------------------------------------------------------

export async function planPack({ root, names, labels, today, register }) {
  const files = [];
  for (const [template, output] of TEMPLATE_FILES) {
    const path = output(names);
    const markdown = path.endsWith('.md');
    const source = readFileSync(join(TEMPLATE_DIR, template), 'utf8');
    const rendered = renderTemplate(source, placeholderValues(names, labels, today, markdown), template);
    const content = path.endsWith('.ts') ? await formatTs(root, path, rendered) : rendered;
    files.push({ path, content });
  }
  files.splice(0, 0, { path: `${names.dir}/package.json`, content: packageJsonFor(root, names) });
  files.splice(1, 0, {
    path: `${names.dir}/tsconfig.json`,
    content: readFileSync(join(root, 'packs/example/tsconfig.json'), 'utf8'),
  });
  for (const file of files)
    if (file.content.includes('__PACK_')) throw new PackNewError(`${file.path}: a template placeholder was left`);
  const edits = register ? await planEdits(root, names) : [];
  const count = templateCount(readTextOrNull(join(root, REGISTER_FILES.workforceSpec)) ?? '');
  return { packDir: names.dir, specPath: names.spec, files, edits, steps: nextSteps(names, { register, count }) };
}

// ---- write (AC-12) ------------------------------------------------------------------------------------------------------

export const defaultIo = Object.freeze({
  /** Returns the first directory it created (undefined when the path already existed), like mkdirSync. */
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  mkdtemp: (prefix) => mkdtempSync(prefix),
  writeFile: (path, content, flag = 'w') => writeFileSync(path, content, { flag }),
  readFile: (path) => readFileSync(path, 'utf8'),
  rename: (from, to) => renameSync(from, to),
  remove: (path) => rmSync(path, { recursive: true, force: true }),
  exists: (path) => lstatOrNull(path) !== null,
  signals: process,
});

/** Both write targets must resolve to <root>/packs/<k> and <root>/docs/specs/pack-<k>.md (path traversal, AC-9). */
export function assertTargets(root, plan) {
  const packs = realpathSync(join(root, 'packs'));
  const target = resolve(packs, basename(plan.packDir));
  if (dirname(target) !== packs || `packs/${basename(target)}` !== plan.packDir)
    throw new PackNewError(`refusing to write outside ${packs}: ${plan.packDir}`);
  const specs = realpathSync(join(root, 'docs/specs'));
  const spec = resolve(specs, basename(plan.specPath));
  if (dirname(spec) !== specs || `docs/specs/${basename(spec)}` !== plan.specPath)
    throw new PackNewError(`refusing to write outside ${specs}: ${plan.specPath}`);
  return { target, spec };
}

// Lets a pending SIGINT/SIGTERM listener run between write steps.
const tick = () => nextTurn();

// Removes the empty directories this run created for staging (from `dir` up to `top`, the first one mkdir created).
function removeEmptyChain(dir, top) {
  if (typeof top !== 'string') return;
  for (let current = dir; ; current = dirname(current)) {
    try {
      if (readdirSync(current).length > 0) return;
      rmSync(current, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
    if (current === top || dirname(current) === current) return;
  }
}

export async function writePlan(plan, root, overrides = {}) {
  const io = { ...defaultIo, ...overrides };
  const { target, spec } = assertTargets(root, plan);
  const created = [];
  const edited = [];
  let interrupted = null;
  let current = null;
  const onSignal = (signal) => {
    interrupted ??= signal;
  };
  io.signals.on('SIGINT', onSignal);
  io.signals.on('SIGTERM', onSignal);
  const step = async (path, action) => {
    await tick();
    if (interrupted) throw new PackNewInterrupted(interrupted);
    current = path;
    action();
  };
  const stagingBase = join(root, STAGING_DIR);
  let staging = null;
  let createdBase;
  try {
    await step(STAGING_DIR, () => {
      createdBase = io.mkdir(stagingBase);
    });
    await step(STAGING_DIR, () => {
      staging = io.mkdtemp(join(stagingBase, `${basename(plan.packDir)}-`));
    });
    for (const file of plan.files.filter((candidate) => candidate.path.startsWith(`${plan.packDir}/`))) {
      const path = join(staging, file.path.slice(plan.packDir.length + 1));
      await step(file.path, () => {
        io.mkdir(dirname(path));
        io.writeFile(path, file.content, 'wx');
      });
    }
    await step(plan.packDir, () => {
      if (io.exists(target)) throw new Error(`${plan.packDir} appeared after planning`);
      io.rename(staging, target);
      created.push(target);
      staging = null;
    });
    const specFile = plan.files.find((candidate) => candidate.path === plan.specPath);
    if (specFile)
      await step(plan.specPath, () => {
        io.writeFile(spec, specFile.content, 'wx');
        created.push(spec);
      });
    for (const edit of plan.edits) {
      await step(edit.path, () => {
        const path = join(root, edit.path);
        if (io.readFile(path) !== edit.before) throw new Error(`${edit.path} changed after planning`);
        io.writeFile(path, edit.after);
        edited.push(edit);
      });
    }
    await tick();
    if (interrupted) throw new PackNewInterrupted(interrupted);
    return {
      created: created.map((path) => relative(root, path).split(sep).join('/')),
      edited: edited.map((e) => e.path),
    };
  } catch (error) {
    const rollbackProblems = [];
    for (const edit of [...edited].reverse()) {
      try {
        defaultIo.writeFile(join(root, edit.path), edit.before);
      } catch (restoreError) {
        rollbackProblems.push(`could not restore ${edit.path}: ${restoreError.message}`);
      }
    }
    for (const path of [...created].reverse()) {
      try {
        defaultIo.remove(path);
      } catch (removeError) {
        rollbackProblems.push(`could not remove ${path}: ${removeError.message}`);
      }
    }
    if (error instanceof PackNewInterrupted) {
      error.problems = rollbackProblems;
      throw error;
    }
    throw new PackNewError(
      `Writing ${current ?? 'the pack'} failed: ${error instanceof Error ? error.message : String(error)}. Everything this run wrote was removed or restored.`,
      rollbackProblems,
    );
  } finally {
    io.signals.off('SIGINT', onSignal);
    io.signals.off('SIGTERM', onSignal);
    if (staging) defaultIo.remove(staging);
    removeEmptyChain(stagingBase, createdBase);
  }
}

// ---- output -------------------------------------------------------------------------------------------------------------

export function lineDiff(before, after, context = 2) {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const out = [];
  for (let i = Math.max(0, start - context); i < start; i += 1) out.push(`  ${a[i]}`);
  for (let i = start; i < endA; i += 1) out.push(`- ${a[i]}`);
  for (let i = start; i < endB; i += 1) out.push(`+ ${b[i]}`);
  for (let i = endA; i < Math.min(a.length, endA + context); i += 1) out.push(`  ${a[i]}`);
  return out;
}

const lineCount = (text) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);

function localDate(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export async function main(argv, { stdout = process.stdout, stderr = process.stderr, today, io } = {}) {
  let args;
  try {
    args = parsePackNewArgs(argv);
  } catch (error) {
    if (!(error instanceof PackNewUsageError)) throw error;
    stderr.write(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    stdout.write(USAGE);
    return 0;
  }
  const problems = [
    ...validatePackName(args.name),
    ...(args.labelJa === undefined ? [] : validateLabel(args.labelJa, '--label-ja')),
    ...(args.labelEn === undefined ? [] : validateLabel(args.labelEn, '--label-en')),
  ];
  if (problems.length) {
    stderr.write(`pack-new: refused (nothing was written)\n${problems.map((p) => `  - ${p}\n`).join('')}`);
    return 1;
  }
  const names = packNames(args.name);
  const labels = defaultLabels(names, args);
  for (const warning of labels.warnings) stderr.write(`${warning}\n`);
  const collisions = findCollisions(args.root, names);
  for (const warning of collisions.warnings) stderr.write(`${warning}\n`);
  if (collisions.problems.length) {
    stderr.write(`pack-new: refused (nothing was written)\n${collisions.problems.map((p) => `  - ${p}\n`).join('')}`);
    return 1;
  }
  let plan;
  try {
    plan = await planPack({
      root: args.root,
      names,
      labels,
      today: today ?? localDate(),
      register: args.register,
    });
  } catch (error) {
    if (!(error instanceof PackNewError)) throw error;
    stderr.write(`pack-new: ${error.message}\n${error.problems.map((p) => `  - ${p}\n`).join('')}`);
    return 1;
  }
  const steps = `\nNext steps:\n${plan.steps.map((line) => `  ${line}\n`).join('')}`;
  if (args.dryRun) {
    stdout.write(`pack-new --dry-run: nothing was written.\n\nFiles:\n`);
    for (const file of plan.files) stdout.write(`  ${file.path} (${lineCount(file.content)} lines)\n`);
    if (plan.edits.length) {
      stdout.write('\nEdits:\n');
      for (const edit of plan.edits)
        stdout.write(
          `  ${edit.path}\n${lineDiff(edit.before, edit.after)
            .map((line) => `    ${line}\n`)
            .join('')}`,
        );
    }
    stdout.write(steps);
    return 0;
  }
  try {
    const written = await writePlan(plan, args.root, io);
    stdout.write(
      `Created ${plan.packDir} (${plan.files.length - 1} files) and ${plan.specPath}.\n` +
        (written.edited.length ? `Edited ${written.edited.join(', ')}.\n` : ''),
    );
    stdout.write(steps);
    return 0;
  } catch (error) {
    if (error instanceof PackNewInterrupted) {
      stderr.write(`pack-new: ${error.message}; everything this run wrote was removed or restored.\n`);
      for (const problem of error.problems ?? []) stderr.write(`  - ${problem}\n`);
      return error.signal === 'SIGTERM' ? 143 : 130;
    }
    if (!(error instanceof PackNewError)) throw error;
    stderr.write(`pack-new: ${error.message}\n${error.problems.map((p) => `  - ${p}\n`).join('')}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`pack-new: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
