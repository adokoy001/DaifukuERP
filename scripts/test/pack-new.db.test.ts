// docs/specs/pack-scaffold.md AC-24 (with AC-13..AC-18): the generated pack's DB test runs against the current kernel and
// partner on every DB run. The pack is generated into a temporary workspace outside the repository (its node_modules
// links each entry of packs/example/node_modules, so the child's .vite cache stays in the temporary directory) and its
// test/pack.db.test.ts runs in a child vitest
// on the same test database (TEST_DATABASE_URL_OWNER / TEST_DATABASE_URL). This suite opens no connection itself, so
// the child's freshDb() may recreate the database. Each AC below asserts that the generated tests carrying the matching
// generated AC id passed, and that nothing failed or was skipped.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT, main } from '../pack-new.mjs';

interface AssertionResult {
  title: string;
  fullName: string;
  status: string;
  failureMessages: string[];
}
interface JsonReport {
  numTotalTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests: number;
  testResults: { status: string; message: string; assertionResults: AssertionResult[] }[];
}

const NAME = 'scaffold-probe';
let workspace = '';
let report: JsonReport | null = null;
let output = '';

function runChild(cwd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; output: string }> {
  return new Promise((resolveRun) => {
    const env = { ...process.env };
    delete env.NODE_PATH;
    for (const key of Object.keys(env)) if (key.startsWith('VITEST')) delete env[key];
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', (chunk: Buffer) => (text += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (text += chunk.toString()));
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ code, output: text });
    });
  });
}

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), 'daifuku-pack-new-db-'));
  for (const path of [
    '.prettierrc.json',
    'tsconfig.base.json',
    'packs/example/package.json',
    'packs/example/tsconfig.json',
  ]) {
    mkdirSync(dirname(join(workspace, path)), { recursive: true });
    cpSync(join(ROOT, path), join(workspace, path));
  }
  mkdirSync(join(workspace, 'docs/specs'), { recursive: true });
  const log = { write: (chunk: string) => (output += chunk) };
  const code = await main(['--root', workspace, NAME, '--label-ja', '雛形検査', '--label-en', 'Scaffold probe'], {
    stdout: log,
    stderr: log,
  });
  if (code !== 0) throw new Error(`pack-new exited ${code}:\n${output}`);
  const pack = join(workspace, 'packs', NAME);
  const modules = join(ROOT, 'packs/example/node_modules');
  mkdirSync(join(pack, 'node_modules'));
  for (const entry of readdirSync(modules).filter((name) => !name.startsWith('.')))
    symlinkSync(join(modules, entry), join(pack, 'node_modules', entry));
  const reportFile = join(workspace, 'report.json');
  const child = await runChild(
    pack,
    [
      join(pack, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--root',
      pack,
      '--reporter=json',
      `--outputFile=${reportFile}`,
      '--testTimeout=30000',
      '--hookTimeout=120000',
      'test/pack.db.test.ts',
    ],
    240_000,
  );
  output += child.output;
  if (existsSync(reportFile)) report = JSON.parse(readFileSync(reportFile, 'utf8')) as JsonReport;
}, 300_000);

afterAll(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

function generated(ac: number): AssertionResult[] {
  if (!report) throw new Error(`the generated DB test produced no report:\n${output}`);
  return report.testResults
    .flatMap((file) => file.assertionResults)
    .filter((result) => new RegExp(`^AC-${ac} `).test(result.title));
}

function expectPassed(ac: number, count: number) {
  const results = generated(ac);
  const failures = results.flatMap((r) => r.failureMessages).join('\n');
  expect(
    results.map((r) => r.status),
    `generated AC-${ac}: ${failures || output}`,
  ).toEqual(Array<string>(count).fill('passed'));
}

describe('pack-scaffold: the generated pack against the current kernel (AC-24)', () => {
  it('AC-24 the generated DB test ran in a child vitest with every test passed and none failed or skipped', () => {
    expect(report, output).not.toBeNull();
    expect(report?.numFailedTests, output).toBe(0);
    expect((report?.numPendingTests ?? 0) + (report?.numTodoTests ?? 0)).toBe(0);
    expect(report?.numTotalTests).toBe(11);
    expect(report?.testResults.map((file) => file.status)).toEqual(['passed']);
  });

  it('AC-13 generated AC-1: the pack, its partner ext, entity, CRUD actions, action and menu are registered', () => {
    expectPassed(1, 1);
  });

  it('AC-14 generated AC-2 and AC-3: first apply seeds once, a second apply writes nothing, force and sample', () => {
    expectPassed(2, 2);
    expectPassed(3, 1);
  });

  it('AC-15 generated AC-4: admin-only apply, viewer read, denied create, roles without a grant and store scope', () => {
    expectPassed(4, 2);
  });

  it('AC-16 generated AC-5: company isolation between applied companies and denial in an unapplied company', () => {
    expectPassed(5, 2);
  });

  it('AC-17 generated AC-6: ext validation on the ext path, where on the ext field and search', () => {
    expectPassed(6, 2);
  });

  it('AC-18 generated AC-7: appMeta of applied and unapplied companies', () => {
    expectPassed(7, 1);
  });
});
