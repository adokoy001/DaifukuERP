// Pack scaffold generator (docs/specs/pack-scaffold.md): generation into a temporary repository copy, derived names,
// label embedding, package.json/tsconfig, formatting, the generated spec, printed steps, --register edits, --dry-run,
// every refusal (usage, names, labels, collisions, insertion points) with "nothing written", rollback on failure,
// signal and changed targets, the type check of the generated sources, and default labels. Each test name carries its AC.
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as prettier from 'prettier';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CATALOG_TEST_MARKER,
  PackNewError,
  REGISTER_FILES,
  RESERVED_NAMES,
  ROOT,
  STAGING_DIR,
  assertTargets,
  defaultIo,
  defaultLabels,
  escapeMarkdown,
  findCollisions,
  main,
  nextSteps,
  packNames,
  planPack,
  validateLabel,
  validatePackName,
  writePlan,
  type PackLabels,
  type PackNewIo,
} from '../pack-new.mjs';

const TODAY = '2026-10-30';
const roots: string[] = [];
const COPIED = [
  '.prettierrc.json',
  'tsconfig.base.json',
  'packs/example/package.json',
  'packs/example/tsconfig.json',
  REGISTER_FILES.catalog,
  REGISTER_FILES.runtimePackage,
  REGISTER_FILES.runtimeTest,
  REGISTER_FILES.workforceSpec,
  'docs/specs/_template.md',
];
// Declarations the collision scan must find (and one under node_modules it must ignore).
const DECLARATIONS: Record<string, string> = {
  'modules/sales/package.json': '{ "name": "@daifuku/mod-sales" }\n',
  'modules/sales/src/module.ts': "export const SalesModule = defineModule({ name: 'sales', depends: [] });\n",
  'modules/sales/src/documents/invoice.ts':
    "export const SalesInvoice = defineDocument({\n  name: 'sales_invoice',\n});\n",
  'modules/crm/src/ext.ts': "registry.registerExt('partner', { loyaltyNote: f.text({ maxLength: 20 }) });\n",
  'modules/sales/node_modules/dep/index.ts': "defineModule({ name: 'ignored_mod' });\n",
  'kernel/test/fixture.ts': "const Widget = defineEntity({ name: 'widget_tag', fields: {} });\n",
  'apps/api/src/extra.ts': "defineModule({ name: 'apiish', depends: [] });\n",
  'apps/odd/package.json': '{ "name": "@daifuku/pack-odd" }\n',
  'packs/real-estate/package.json': '{ "name": "@daifuku/pack-real-estate" }\n',
  'packs/real-estate/src/pack.ts':
    "export const RealEstatePack = definePack({\n  name: 'real_estate',\n  ext: { partner: { tenantRank: f.text() } },\n});\n",
  'packs/x-1/package.json': '{ "name": "@daifuku/pack-x-1" }\n',
};
const TRICKY_EN = 'Bob\'s "x" \\ ${y} */ | `z`';
const TRICKY_JA = "山田's「店」\\ */ ${a}";

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'daifuku-pack-new-'));
  roots.push(root);
  for (const path of COPIED) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    cpSync(join(ROOT, path), join(root, path));
  }
  for (const [path, text] of Object.entries(DECLARATIONS)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** Every path under root (files, symlinks, empty directories) with its content, for "nothing else changed". */
function snapshot(root: string, dir = ''): Map<string, string> {
  const out = new Map<string, string>();
  const entries = readdirSync(join(root, dir), { withFileTypes: true });
  if (dir && entries.length === 0) out.set(`${dir}/`, '<empty dir>');
  for (const entry of entries) {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) out.set(path, `symlink:${readlinkSync(join(root, path))}`);
    else if (entry.isDirectory()) for (const [k, v] of snapshot(root, path)) out.set(k, v);
    else out.set(path, readFileSync(join(root, path), 'utf8'));
  }
  return out;
}

function changes(before: Map<string, string>, after: Map<string, string>) {
  return {
    added: [...after.keys()].filter((key) => !before.has(key)).sort(),
    removed: [...before.keys()].filter((key) => !after.has(key)).sort(),
    changed: [...after.keys()].filter((key) => before.has(key) && before.get(key) !== after.get(key)).sort(),
  };
}

function lineChanges(before: string, after: string) {
  const a = before.split('\n');
  const b = after.split('\n');
  return {
    removed: a.filter((line) => !b.includes(line)),
    added: b.filter((line) => !a.includes(line)),
  };
}

function capture() {
  const out = { stdout: '', stderr: '' };
  return {
    out,
    io: {
      stdout: { write: (chunk: string) => (out.stdout += chunk) },
      stderr: { write: (chunk: string) => (out.stderr += chunk) },
      today: TODAY,
    },
  };
}

async function run(root: string, args: string[], extra: { io?: Partial<PackNewIo> } = {}) {
  const { out, io } = capture();
  const code = await main(['--root', root, ...args], { ...io, ...extra });
  return { code, ...out };
}

const labels = (ja: string, en: string): PackLabels => ({ ja, en, jaDefaulted: false, warnings: [] });
const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8');
const BIKE_FILES = [
  'docs/specs/pack-bike-shop.md',
  'packs/bike-shop/package.json',
  'packs/bike-shop/src/actions/count-tags.ts',
  'packs/bike-shop/src/entities/bike-shop-tag.ts',
  'packs/bike-shop/src/index.ts',
  'packs/bike-shop/src/pack.ts',
  'packs/bike-shop/src/sample.ts',
  'packs/bike-shop/src/seed.ts',
  'packs/bike-shop/test/pack.db.test.ts',
  'packs/bike-shop/tsconfig.json',
];
const BIKE_ARGS = ['bike-shop', '--label-ja', '自転車店', '--label-en', 'Bike shop'];
// The registration targets are copied from the repository, so expectations derive from their current content (the
// catalog grows whenever a pack is registered) instead of naming today's last pack or template count.
const COUNT_LINE = /^.*利用できる業界テンプレート (\d+) 種.*$/m;
function templateCountLine(text: string): { line: string; count: number } {
  const match = COUNT_LINE.exec(text);
  if (!match?.[1]) throw new Error('workforce.spec.ts has no template count');
  return { line: match[0], count: Number(match[1]) };
}
function lastCatalogEntry(text: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.includes(CATALOG_TEST_MARKER));
  const end = lines.findIndex((line, index) => index > start && /^\s*\]\);\s*$/.test(line));
  return lines[end - 1] ?? '';
}
const repoCount = () => templateCountLine(readFileSync(join(ROOT, REGISTER_FILES.workforceSpec), 'utf8')).count;

describe('pack-new generation (AC-1..AC-5)', { timeout: 30_000 }, () => {
  it('AC-1 creates exactly the ten files, changes nothing else, leaves no staging directory and exits 0', async () => {
    const root = fixture();
    const before = snapshot(root);
    const result = await run(root, BIKE_ARGS);
    expect(result.code, result.stderr).toBe(0);
    expect(changes(before, snapshot(root))).toEqual({ added: BIKE_FILES, removed: [], changed: [] });
    expect(existsSync(join(root, STAGING_DIR))).toBe(false);
    expect(result.stdout).toContain('Created packs/bike-shop (9 files) and docs/specs/pack-bike-shop.md.');
  });

  it('AC-2 derives the names of the table, embeds them and leaves no placeholder; pack.ts has the required shape only', async () => {
    expect(packNames('bike-shop')).toEqual({
      kebab: 'bike-shop',
      snake: 'bike_shop',
      pascal: 'BikeShop',
      camel: 'bikeShop',
      code: 'BIKESHOP',
      dir: 'packs/bike-shop',
      packageName: '@daifuku/pack-bike-shop',
      packExport: 'BikeShopPack',
      entity: 'bike_shop_tag',
      entityExport: 'BikeShopTag',
      entityFile: 'packs/bike-shop/src/entities/bike-shop-tag.ts',
      action: 'bike_shop.count_tags',
      extKey: 'bikeShopNote',
      sampleCode: 'BIKESHOP-0001',
      spec: 'docs/specs/pack-bike-shop.md',
      migration: 'pack_bike_shop',
    });
    expect(packNames('professional-services-x').code).toBe('PROFESSIONAL');
    expect(packNames('x-1')).toMatchObject({ snake: 'x_1', pascal: 'X1', camel: 'x1', extKey: 'x1Note' });

    const root = fixture();
    expect((await run(root, BIKE_ARGS)).code).toBe(0);
    for (const path of BIKE_FILES) expect(read(root, path), path).not.toContain('__PACK_');
    const pack = read(root, 'packs/bike-shop/src/pack.ts');
    for (const part of [
      'export const BikeShopPack = definePack({',
      "name: 'bike_shop',",
      "label: label('自転車店', 'Bike shop'),",
      "version: '0.1.0',",
      'depends: [PartnerModule.name],',
      'bikeShopNote: f.text({',
      'entities: [BikeShopTag],',
      'actions: [countTagsAction],',
      "menus: [{ label: label('自転車店のタグ', 'Bike shop tags'), entity: 'bike_shop_tag', order: 90 }],",
      'seed: seedBikeShop,',
      'sample: sampleBikeShop,',
    ])
      expect(pack).toContain(part);
    for (const absent of ['settings:', 'labels:', 'hooks:']) expect(pack).not.toContain(absent);
    expect(read(root, 'packs/bike-shop/src/entities/bike-shop-tag.ts')).toContain("name: 'bike_shop_tag',");
    expect(read(root, 'packs/bike-shop/src/actions/count-tags.ts')).toContain("name: 'bike_shop.count_tags',");
    expect(read(root, 'packs/bike-shop/src/sample.ts')).toContain("['BIKESHOP-0001']");
    expect(read(root, 'packs/bike-shop/src/index.ts')).toContain("export { BikeShopPack } from './pack.ts';");
  });

  it('AC-2 labels with quotes, backslashes, ${}, */, | and backticks keep their exact value as string literals (never comments) and are escaped in Markdown', async () => {
    const root = fixture();
    const names = packNames('bike-shop');
    const plan = await planPack({ root, names, labels: labels(TRICKY_JA, TRICKY_EN), today: TODAY, register: false });
    const options = JSON.parse(read(root, '.prettierrc.json')) as prettier.Options;
    for (const file of plan.files.filter((f) => f.path.endsWith('.ts'))) {
      expect(await prettier.check(file.content, { ...options, filepath: join(root, file.path) }), file.path).toBe(true);
      const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
      const literals: { start: number; end: number; text: string }[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
          literals.push({ start: node.getStart(source), end: node.getEnd(), text: node.text });
        ts.forEachChild(node, visit);
      };
      visit(source);
      for (const marker of ['Bob', '山田']) {
        for (let at = file.content.indexOf(marker); at >= 0; at = file.content.indexOf(marker, at + 1))
          expect(
            literals.some((literal) => literal.start < at && at < literal.end),
            `${file.path}: ${marker} outside a string literal`,
          ).toBe(true);
      }
      if (file.path.endsWith('src/pack.ts'))
        expect(literals.map((l) => l.text)).toEqual(
          expect.arrayContaining([
            TRICKY_JA,
            TRICKY_EN,
            `${TRICKY_JA}のタグ`,
            `${TRICKY_EN} tags`,
            `${TRICKY_JA}の備考`,
            `${TRICKY_EN} note`,
          ]),
        );
    }
    const spec = plan.files.find((f) => f.path === names.spec)?.content ?? '';
    expect(spec).toContain(`# Spec: pack-bike-shop（${escapeMarkdown(TRICKY_JA)} ／ ${escapeMarkdown(TRICKY_EN)}）`);
    expect(escapeMarkdown('a|b`c[d](e)<f>#_*\\')).toBe('a\\|b\\`c\\[d\\](e)\\<f\\>\\#\\_\\*\\\\');
  });

  it('AC-3 package.json is derived from packs/example (a subset of its dependencies) and tsconfig.json is identical', async () => {
    const root = fixture();
    expect((await run(root, BIKE_ARGS)).code).toBe(0);
    const example = JSON.parse(read(root, 'packs/example/package.json')) as Record<string, Record<string, string>>;
    const text = read(root, 'packs/bike-shop/package.json');
    const pkg = JSON.parse(text) as Record<string, Record<string, string>>;
    expect(text).toBe(`${JSON.stringify(pkg, null, 2)}\n`);
    expect(Object.keys(pkg)).toEqual([
      'name',
      'version',
      'private',
      'type',
      'exports',
      'scripts',
      'devDependencies',
      'dependencies',
    ]);
    expect(pkg).toEqual({
      name: '@daifuku/pack-bike-shop',
      version: '0.0.1',
      private: example.private,
      type: example.type,
      exports: example.exports,
      scripts: { typecheck: example.scripts?.typecheck },
      devDependencies: {
        '@types/node': example.devDependencies?.['@types/node'],
        typescript: example.devDependencies?.typescript,
        vitest: example.devDependencies?.vitest,
      },
      dependencies: {
        '@daifuku/kernel': 'workspace:*',
        zod: example.dependencies?.zod,
        '@daifuku/mod-partner': 'workspace:*',
      },
    });
    for (const group of ['dependencies', 'devDependencies'])
      for (const [name, range] of Object.entries(pkg[group] ?? {})) expect(example[group]?.[name]).toBe(range);
    expect(read(root, 'packs/bike-shop/tsconfig.json')).toBe(read(root, 'packs/example/tsconfig.json'));
  });

  it('AC-4 every generated and edited .ts file passes the Prettier check with the repository configuration', async () => {
    const root = fixture();
    const plan = await planPack({
      root,
      names: packNames('a-very-long-pack-name-xyz'),
      labels: labels('とても長い名前の業種テンプレートの日本語ラベルです', 'A rather long English label for wrapping'),
      today: TODAY,
      register: true,
    });
    const options = JSON.parse(read(root, '.prettierrc.json')) as prettier.Options;
    const outputs = [
      ...plan.files.filter((f) => f.path.endsWith('.ts')).map((f) => [f.path, f.content] as const),
      ...plan.edits.filter((e) => e.path.endsWith('.ts')).map((e) => [e.path, e.after] as const),
    ];
    expect(outputs).toHaveLength(10);
    for (const [path, content] of outputs)
      expect(await prettier.check(content, { ...options, filepath: join(root, path) }), path).toBe(true);
  });

  it('AC-5 the spec has the template headings in order, draft status, the date, AC-1..AC-7 matching the test names, and TODO: fields', async () => {
    const root = fixture();
    expect((await run(root, BIKE_ARGS)).code).toBe(0);
    const spec = read(root, 'docs/specs/pack-bike-shop.md');
    const headings = (text: string) => text.split('\n').filter((line) => line.startsWith('## '));
    expect(headings(spec)).toEqual(headings(readFileSync(join(ROOT, 'docs/specs/_template.md'), 'utf8')));
    expect(spec).toContain('- 状態: draft');
    expect(spec).toContain(`- 作成: ${TODAY} `);
    const specAcs = [...spec.matchAll(/^- AC-(\d+) /gm)].map((m) => Number(m[1]));
    expect(specAcs).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const test = read(root, 'packs/bike-shop/test/pack.db.test.ts');
    const testAcs = new Set([...test.matchAll(/\bit\(\s*['"`]AC-(\d+) /g)].map((m) => Number(m[1])));
    expect([...testAcs].sort((a, b) => a - b)).toEqual(specAcs);
    const section = (title: string) => spec.split(/^## /m).find((part) => part.startsWith(title)) ?? '';
    for (const title of ['目的', '受入基準', 'データ・業務ルール', 'スコープ外', '未決事項'])
      expect(section(title), title).toMatch(/^(- )?TODO: /m);
  });
});

describe('pack-new steps (AC-6)', { timeout: 30_000 }, () => {
  it('AC-6 prints the steps in order in both modes: register, pnpm install, db:generate, checks, gate:light, optional, apply', async () => {
    const names = packNames('bike-shop');
    for (const register of [false, true]) {
      const count = repoCount();
      const steps = nextSteps(names, { register, count });
      const order = [
        (line: string) => line.startsWith('1. Register'),
        (line: string) => line.startsWith('2. pnpm install'),
        (line: string) => line.startsWith('3. pnpm db:generate pack_bike_shop') && line.includes('after registering'),
        (line: string) => line.startsWith('4. pnpm --filter @daifuku/pack-bike-shop typecheck'),
        (line: string) => line.includes('pnpm exec vitest run --project db packs/bike-shop/test/pack.db.test.ts'),
        (line: string) => line.startsWith('5. pnpm gate:light'),
        (line: string) => line.startsWith('6. Optional') && line.includes('DAIFUKU_PACKS'),
        (line: string) => line.startsWith('7. Apply: pnpm pack:apply bike_shop --sample'),
      ].map((match) => steps.findIndex(match));
      expect(
        order.every((index) => index >= 0),
        `${register}: ${steps.join('\n')}`,
      ).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      if (register) expect(steps[0]).toContain('done (--register edited');
      else
        expect(steps).toEqual(
          expect.arrayContaining([
            "        bike_shop: async () => (await import('@daifuku/pack-bike-shop')).BikeShopPack,",
            '        "@daifuku/pack-bike-shop": "workspace:*"',
            "        'bike_shop',",
            `        '利用できる業界テンプレート ${count} 種' -> '利用できる業界テンプレート ${count + 1} 種'`,
          ]),
        );
    }
    const root = fixture();
    const result = await run(root, BIKE_ARGS);
    expect(result.stdout).toContain(
      `\nNext steps:\n${nextSteps(names, { register: false, count: repoCount() })
        .map((line) => `  ${line}\n`)
        .join('')}`,
    );
  });
});

describe('pack-new --register (AC-7)', { timeout: 30_000 }, () => {
  it('AC-7 edits exactly the four registration files, each with only its planned change', async () => {
    const root = fixture();
    const before = snapshot(root);
    const result = await run(root, [...BIKE_ARGS, '--register']);
    expect(result.code, result.stderr).toBe(0);
    const after = snapshot(root);
    expect(changes(before, after)).toEqual({
      added: BIKE_FILES,
      removed: [],
      changed: Object.values(REGISTER_FILES).sort(),
    });
    const diff = (path: string) => lineChanges(before.get(path) ?? '', after.get(path) ?? '');
    expect(diff(REGISTER_FILES.catalog)).toEqual({
      removed: [],
      added: ["  bike_shop: async () => (await import('@daifuku/pack-bike-shop')).BikeShopPack,"],
    });
    expect(after.get(REGISTER_FILES.catalog)).toMatch(/BikeShopPack,\n};\n/);
    expect(diff(REGISTER_FILES.runtimeTest)).toEqual({ removed: [], added: ["      'bike_shop',"] });
    const last = lastCatalogEntry(before.get(REGISTER_FILES.runtimeTest) ?? '');
    expect(after.get(REGISTER_FILES.runtimeTest)).toContain(`${last}\n      'bike_shop',\n    ]);`);
    const { line, count } = templateCountLine(before.get(REGISTER_FILES.workforceSpec) ?? '');
    expect(diff(REGISTER_FILES.workforceSpec)).toEqual({
      removed: [line],
      added: [line.replace(`テンプレート ${count} 種`, `テンプレート ${count + 1} 種`)],
    });
    const pkgBefore = JSON.parse(before.get(REGISTER_FILES.runtimePackage) ?? '{}') as Record<string, unknown>;
    const pkgAfter = JSON.parse(after.get(REGISTER_FILES.runtimePackage) ?? '{}') as Record<string, unknown>;
    expect(after.get(REGISTER_FILES.runtimePackage)).toBe(`${JSON.stringify(pkgAfter, null, 2)}\n`);
    const deps = (pkg: Record<string, unknown>) => pkg.dependencies as Record<string, string>;
    expect(Object.entries(deps(pkgAfter))).toEqual([
      ...Object.entries(deps(pkgBefore)),
      ['@daifuku/pack-bike-shop', 'workspace:*'],
    ]);
    expect({ ...pkgAfter, dependencies: null }).toEqual({ ...pkgBefore, dependencies: null });
    expect(result.stdout).toContain(`Edited ${Object.values(REGISTER_FILES).join(', ')}.`);
  });
});

describe('pack-new --dry-run (AC-8)', { timeout: 30_000 }, () => {
  it('AC-8 lists the files with line counts, the edit diffs and the steps, and writes nothing', async () => {
    const root = fixture();
    const before = snapshot(root);
    const result = await run(root, [...BIKE_ARGS, '--register', '--dry-run']);
    expect(result.code, result.stderr).toBe(0);
    expect(snapshot(root)).toEqual(before);
    for (const path of BIKE_FILES) expect(result.stdout).toMatch(new RegExp(`  ${path} \\(\\d+ lines\\)\\n`));
    expect(result.stdout).toContain(
      "+   bike_shop: async () => (await import('@daifuku/pack-bike-shop')).BikeShopPack,",
    );
    expect(result.stdout).toContain("+       'bike_shop',");
    expect(result.stdout).toContain('+     "@daifuku/pack-bike-shop": "workspace:*"');
    expect(result.stdout).toContain('Next steps:\n  1. Register: done');
  });

  it('AC-8 a refusal still applies under --dry-run (exit 1)', async () => {
    const root = fixture();
    const before = snapshot(root);
    expect((await run(root, ['real-estate', '--dry-run'])).code).toBe(1);
    expect(snapshot(root)).toEqual(before);
  });
});

describe('pack-new refusals (AC-9..AC-11)', { timeout: 30_000 }, () => {
  it('AC-9 usage errors exit 2 with the usage on stderr and write nothing', async () => {
    const root = fixture();
    const before = snapshot(root);
    for (const args of [
      [],
      ['a-b', 'c-d'],
      ['bike-shop', '--bogus'],
      ['bike-shop', '--label-ja'],
      ['bike-shop', '--label-en', '--register'],
    ]) {
      const result = await run(root, args);
      expect(result.code, args.join(' ')).toBe(2);
      expect(result.stderr).toContain('Usage: node scripts/pack-new.mjs <name>');
    }
    expect(snapshot(root)).toEqual(before);
  });

  it('AC-9 names outside the kebab-case rule (traversal shapes included) exit 1 with the rule and a corrected example', async () => {
    const root = fixture();
    const before = snapshot(root);
    const bad = ['bike_shop', 'BikeShop', 'a', 'x'.repeat(25), '../evil', 'packs/evil', '/abs', 'a..b', '.hidden'];
    bad.push('bad name', 'café', 'a\\b', 'a\0b', '-lead', 'trail-', 'double--hyphen', '1abc', '.', '..');
    for (const name of bad) {
      const result = await run(root, ['--', name]);
      expect(result.code, name).toBe(1);
      expect(result.stderr).toContain('refused (nothing was written)');
    }
    expect((await run(root, ['bike_shop'])).stderr).toContain('(e.g. bike_shop -> bike-shop)');
    expect((await run(root, ['BikeShop'])).stderr).toContain('(e.g. BikeShop -> bike-shop)');
    expect(validatePackName('bike-shop')).toEqual([]);
    expect(validatePackName('ab')).toEqual([]);
    expect(validatePackName('x'.repeat(24))).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });

  it('AC-9 reserved names are refused', async () => {
    const root = fixture();
    const before = snapshot(root);
    expect(RESERVED_NAMES).toEqual(['pack', 'packs', 'all', 'none', 'kernel', 'company', 'constructor', 'missing']);
    for (const name of RESERVED_NAMES) {
      const result = await run(root, [name]);
      expect(result.code, name).toBe(1);
      expect(result.stderr).toContain('is reserved');
    }
    expect(snapshot(root)).toEqual(before);
  });

  it('AC-9 labels outside the rule are refused; 40 code points, emoji and Japanese are accepted', async () => {
    const root = fixture();
    const before = snapshot(root);
    const bad = ['', 'x'.repeat(41), 'あ'.repeat(41), ' lead', 'trail ', 'a\nb', 'a\u0007b', 'a‮b'];
    bad.push('a b', 'a b', '\uD800', 'x__PACK_SNAKE__');
    for (const label of bad) {
      for (const option of ['--label-ja', '--label-en']) {
        const result = await run(root, ['bike-shop', `${option}=${label}`]);
        expect(result.code, `${option} ${JSON.stringify(label)}`).toBe(1);
        expect(result.stderr).toContain(option);
      }
    }
    for (const good of ['あ'.repeat(40), '😀'.repeat(40), TRICKY_EN, TRICKY_JA, 'Café & Bar'])
      expect(validateLabel(good, '--label-en'), good).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });

  it('AC-9 the resolved targets must be directly under packs/ and docs/specs/ (second defence)', () => {
    const root = fixture();
    expect(() => assertTargets(root, { packDir: 'packs/../evil', specPath: 'docs/specs/pack-x.md' })).toThrow(
      PackNewError,
    );
    expect(() => assertTargets(root, { packDir: 'packs/a/b', specPath: 'docs/specs/pack-x.md' })).toThrow(PackNewError);
    expect(() => assertTargets(root, { packDir: 'packs/ok', specPath: 'docs/specs/../x.md' })).toThrow(PackNewError);
    expect(assertTargets(root, { packDir: 'packs/ok', specPath: 'docs/specs/pack-ok.md' }).target).toBe(
      join(root, 'packs/ok'),
    );
    rmSync(join(root, 'docs/specs'), { recursive: true });
    expect(() => assertTargets(root, { packDir: 'packs/ok', specPath: 'docs/specs/pack-ok.md' })).toThrow(
      'docs/specs/ does not exist',
    );
  });

  it('AC-10 lists every collision (directory, package name, module/pack, entity, ext key, derived identifiers, catalog key, spec) and writes nothing', async () => {
    const root = fixture();
    mkdirSync(join(root, 'packs/stale/node_modules'), { recursive: true });
    symlinkSync(join(root, 'packs/example'), join(root, 'packs/linked'));
    writeFileSync(join(root, 'docs/specs/pack-lonely.md'), '# taken\n');
    const before = snapshot(root);
    const cases: [string, string[]][] = [
      [
        'real-estate',
        [
          'packs/real-estate already exists.',
          '@daifuku/pack-real-estate is already the name of packs/real-estate/package.json.',
          'module/pack "real_estate" is already declared in packs/real-estate/src/pack.ts.',
          '"real_estate" is already a key of AVAILABLE in apps/runtime/src/packs.ts.',
        ],
      ],
      ['sales', ['module/pack "sales" is already declared in modules/sales/src/module.ts.']],
      ['sales-invoice', ['entity "sales_invoice" is already declared in modules/sales/src/documents/invoice.ts.']],
      ['widget', ['entity "widget_tag" is already declared in kernel/test/fixture.ts.']],
      ['apiish', ['module/pack "apiish" is already declared in apps/api/src/extra.ts.']],
      ['loyalty', ['ext key "loyaltyNote" already appears in modules/crm/src/ext.ts.']],
      ['x1', ['packs/x-1 derives the same identifiers (X1Pack, x1Note); choose another name.']],
      ['odd', ['@daifuku/pack-odd is already the name of apps/odd/package.json.']],
      ['lonely', ['docs/specs/pack-lonely.md already exists.']],
      ['stale', ['packs/stale already exists.']],
      ['linked', ['packs/linked already exists.']],
      ['beauty-salon', ['"beauty_salon" is already a key of AVAILABLE in apps/runtime/src/packs.ts.']],
    ];
    for (const [name, expected] of cases) {
      const result = await run(root, [name, '--register']);
      expect(result.code, name).toBe(1);
      for (const line of expected) expect(result.stderr, name).toContain(`  - ${line}\n`);
    }
    expect(findCollisions(root, packNames('ignored-mod')).problems).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });

  it('AC-10 against the real repository sales, real-estate, sales-invoice and example collide (read only)', () => {
    for (const name of ['sales', 'real-estate', 'sales-invoice', 'example'])
      expect(findCollisions(ROOT, packNames(name)).problems.length, name).toBeGreaterThan(0);
    expect(findCollisions(ROOT, packNames('sales-invoice')).problems).toEqual([
      'entity "sales_invoice" is already declared in modules/sales/src/entities/sales-invoice.ts.',
    ]);
  });

  it('AC-10 a staging directory left by an interrupted run is reported as a warning, not a refusal', async () => {
    const root = fixture();
    mkdirSync(join(root, STAGING_DIR, 'old-123'), { recursive: true });
    const result = await run(root, BIKE_ARGS);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain(`warning: ${STAGING_DIR}/old-123 was left by an interrupted run`);
    expect(readdirSync(join(root, STAGING_DIR))).toEqual(['old-123']);
  });

  it('AC-11 a missing, repeated or already-filled insertion point refuses before any write, the pack included', async () => {
    const variants: [string, (text: string) => string, string][] = [
      [REGISTER_FILES.catalog, (t) => t.replace('const AVAILABLE', 'const CATALOG'), 'found 0 times'],
      [REGISTER_FILES.catalog, (t) => `${t}\nconst AVAILABLE = {};\n`, 'found 2 times'],
      [REGISTER_FILES.catalog, (t) => t.replace(/^};$/m, '} as const;'), 'closing `};`'],
      [
        REGISTER_FILES.runtimeTest,
        (t) => t.replace(CATALOG_TEST_MARKER, 'expect(schema.packs).toStrictEqual(['),
        '0 times',
      ],
      [
        REGISTER_FILES.runtimeTest,
        (t) => t.replace(lastCatalogEntry(t), `${lastCatalogEntry(t)}\n      'bike_shop',`),
        'already',
      ],
      [REGISTER_FILES.runtimePackage, (t) => JSON.stringify(JSON.parse(t), null, 4), 'reformat'],
      [
        REGISTER_FILES.runtimePackage,
        (t) => t.replace('"@daifuku/kernel": "workspace:*",', '"@daifuku/pack-bike-shop": "workspace:*",'),
        'already depends',
      ],
      [REGISTER_FILES.workforceSpec, (t) => t.replace(/業界テンプレート \d+ 種/, '業界テンプレート'), 'found 0 times'],
      [REGISTER_FILES.workforceSpec, (t) => `${t}\n// 利用できる業界テンプレート 1 種\n`, 'found 2 times'],
    ];
    for (const [path, mutate, reason] of variants) {
      const root = fixture();
      writeFileSync(join(root, path), mutate(read(root, path)));
      const before = snapshot(root);
      const result = await run(root, [...BIKE_ARGS, '--register']);
      expect(result.code, `${path}: ${reason}`).toBe(1);
      expect(result.stderr).toContain(`${path}: `);
      expect(result.stderr).toContain(reason);
      expect(result.stderr).toContain('Register by hand: ');
      expect(snapshot(root)).toEqual(before);
    }
  });
});

describe('pack-new write order and rollback (AC-12)', { timeout: 30_000 }, () => {
  async function registerPlan(root: string) {
    return planPack({
      root,
      names: packNames('bike-shop'),
      labels: labels('自転車店', 'Bike shop'),
      today: TODAY,
      register: true,
    });
  }

  it('AC-12 a failing write removes everything the run created and restores every edited file', async () => {
    for (const failing of ['src/seed.ts', 'pack-bike-shop.md', 'workforce.spec.ts']) {
      const root = fixture();
      const plan = await registerPlan(root);
      const before = snapshot(root);
      const writeFile = (path: string, content: string, flag?: string) => {
        if (path.endsWith(failing)) throw new Error('disk full');
        defaultIo.writeFile(path, content, flag);
      };
      const error = await writePlan(plan, root, { writeFile }).catch((e: unknown) => e);
      expect(error, failing).toBeInstanceOf(PackNewError);
      expect((error as Error).message).toContain('disk full');
      expect(snapshot(root), failing).toEqual(before);
    }
  });

  it('AC-12 an edit target changed after planning aborts the run and rolls back', async () => {
    const root = fixture();
    const plan = await registerPlan(root);
    writeFileSync(join(root, REGISTER_FILES.runtimeTest), `${read(root, REGISTER_FILES.runtimeTest)}// changed\n`);
    const before = snapshot(root);
    await expect(writePlan(plan, root)).rejects.toThrow(`${REGISTER_FILES.runtimeTest} changed after planning`);
    expect(snapshot(root)).toEqual(before);
  });

  it('AC-12 a pack directory or spec that appears after planning is never overwritten', async () => {
    const root = fixture();
    const plan = await registerPlan(root);
    mkdirSync(join(root, 'packs/bike-shop'));
    const before = snapshot(root);
    await expect(writePlan(plan, root)).rejects.toThrow('packs/bike-shop appeared after planning');
    expect(snapshot(root)).toEqual(before);

    const second = fixture();
    const plan2 = await registerPlan(second);
    writeFileSync(join(second, 'docs/specs/pack-bike-shop.md'), 'mine\n');
    const before2 = snapshot(second);
    await expect(writePlan(plan2, second)).rejects.toThrow('docs/specs/pack-bike-shop.md');
    expect(snapshot(second)).toEqual(before2);
  });

  it('AC-12 SIGINT and SIGTERM during the write roll back and exit 130 / 143', async () => {
    for (const [signal, code] of [
      ['SIGINT', 130],
      ['SIGTERM', 143],
    ] as const) {
      const root = fixture();
      const before = snapshot(root);
      const signals = new EventEmitter();
      let writes = 0;
      const writeFile = (path: string, content: string, flag?: string) => {
        defaultIo.writeFile(path, content, flag);
        writes += 1;
        if (writes === 3) signals.emit(signal, signal);
      };
      const result = await run(root, [...BIKE_ARGS, '--register'], { io: { writeFile, signals } });
      expect(result.code, signal).toBe(code);
      expect(result.stderr).toContain(`interrupted by ${signal}`);
      expect(snapshot(root)).toEqual(before);
      expect(signals.listenerCount('SIGINT') + signals.listenerCount('SIGTERM')).toBe(0);
    }
  });

  it('AC-12 files are staged under node_modules/.cache/pack-new and renamed into packs/ in one step', async () => {
    const root = fixture();
    const plan = await registerPlan(root);
    const writes: string[] = [];
    const renames: [string, string][] = [];
    await writePlan(plan, root, {
      writeFile: (path, content, flag) => {
        writes.push(path);
        defaultIo.writeFile(path, content, flag);
      },
      rename: (from, to) => {
        renames.push([from, to]);
        defaultIo.rename(from, to);
      },
    });
    const staging = join(root, STAGING_DIR);
    expect(writes.filter((path) => path.startsWith(join(root, 'packs')))).toEqual([]);
    expect(writes.filter((path) => path.startsWith(staging))).toHaveLength(9);
    expect(renames).toHaveLength(1);
    expect(renames[0]?.[0].startsWith(`${staging}/bike-shop-`)).toBe(true);
    expect(renames[0]?.[1]).toBe(join(root, 'packs/bike-shop'));
    expect(existsSync(staging)).toBe(false);
    expect(lstatSync(join(root, 'packs/bike-shop')).isDirectory()).toBe(true);
  });
});

describe('pack-new type check of the generated sources (AC-20)', () => {
  it(
    'AC-20 the generated src/ and test/ with awkward labels type-check against the current workspace',
    { timeout: 60_000 },
    async () => {
      const root = fixture();
      const result = await run(root, ['bike-shop', '--label-ja', TRICKY_JA, '--label-en', TRICKY_EN]);
      expect(result.code, result.stderr).toBe(0);
      symlinkSync(join(ROOT, 'packs/example/node_modules'), join(root, 'packs/bike-shop/node_modules'));
      const env = { ...process.env };
      delete env.NODE_PATH;
      const tsc = spawnSync(
        process.execPath,
        [join(ROOT, 'node_modules/tsc7/bin/tsc'), '-p', join(root, 'packs/bike-shop/tsconfig.json'), '--noEmit'],
        { encoding: 'utf8', timeout: 50_000, env },
      );
      expect(
        tsc.status,
        `tsc failed (${tsc.signal ?? tsc.error?.message ?? 'exit'}):\n${tsc.stdout}${tsc.stderr}`,
      ).toBe(0);
    },
  );
});

describe('pack-new default labels (AC-23)', { timeout: 30_000 }, () => {
  it('AC-23 without --label-en the title-cased name; without --label-ja the English label, a warning and a TODO in the spec; exit 0', async () => {
    const root = fixture();
    const result = await run(root, ['bike-shop']);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain(
      'warning: --label-ja was not given; the Japanese label is "Bike Shop". Set a Japanese name in packs/bike-shop/src/pack.ts and the spec.\n',
    );
    expect(read(root, 'packs/bike-shop/src/pack.ts')).toContain("label: label('Bike Shop', 'Bike Shop'),");
    expect(read(root, 'docs/specs/pack-bike-shop.md')).toMatch(/^TODO: 日本語ラベルを決める/m);
    expect(defaultLabels(packNames('x-1')).en).toBe('X 1');

    const given = fixture();
    const named = await run(given, ['bike-shop', '--label-ja', '自転車店']);
    expect(named.code).toBe(0);
    expect(named.stderr).not.toContain('warning');
    expect(read(given, 'packs/bike-shop/src/pack.ts')).toContain("label: label('自転車店', 'Bike Shop'),");
    expect(read(given, 'docs/specs/pack-bike-shop.md')).not.toContain('日本語ラベルを決める');
  });
});
