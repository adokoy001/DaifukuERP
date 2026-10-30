// docs/specs/setup-health.md AC-6 (pure parts of the platform items): migrations are counted against the release
// catalog in order, and the storage state distinguishes writable, not yet created and not writable.
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationCounts, storageState } from '../src/health.ts';

const row = (hash: string, created_at: string) => ({ hash, created_at });
const entry = (hash: string, when: string) => ({ hash, when });

describe('setup-health AC-6: migration counts', () => {
  const catalog = [entry('a', '1'), entry('b', '2'), entry('c', '3')];
  it.each([
    [[], { expected: 3, applied: 0, pending: 3, unknown: 0 }],
    [[row('a', '1'), row('b', '2')], { expected: 3, applied: 2, pending: 1, unknown: 0 }],
    [[row('a', '1'), row('b', '2'), row('c', '3')], { expected: 3, applied: 3, pending: 0, unknown: 0 }],
    [[row('a', '1'), row('x', '2')], { expected: 3, applied: 2, pending: 2, unknown: 1 }],
    [[row('a', '1'), row('b', '2'), row('c', '3'), row('d', '4')], { expected: 3, applied: 4, pending: 0, unknown: 1 }],
    [[row('a', '9')], { expected: 3, applied: 1, pending: 3, unknown: 1 }],
  ])('AC-6: applied %j -> %j', (applied, counts) => {
    expect(migrationCounts(catalog, applied)).toEqual(counts);
  });
});

describe('setup-health AC-6: storage state', () => {
  let dir = '';
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'daifuku-storage-state-'));
  });
  afterAll(async () => {
    await chmod(join(dir, 'locked'), 0o700).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });

  it('AC-6: writable, not created yet, a file, and a read-only directory', async () => {
    await mkdir(join(dir, 'ok'));
    expect(await storageState(join(dir, 'ok'))).toBe('writable');
    expect(await storageState(join(dir, 'later'))).toBe('missing');
    await writeFile(join(dir, 'file'), 'x');
    expect(await storageState(join(dir, 'file'))).toBe('not-writable');
    expect(await storageState(join(dir, 'file', 'below'))).toBe('not-writable');
    if (process.getuid?.() !== 0) {
      await mkdir(join(dir, 'locked'));
      await chmod(join(dir, 'locked'), 0o500);
      expect(await storageState(join(dir, 'locked'))).toBe('not-writable');
    }
  });
});
