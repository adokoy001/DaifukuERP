// Safe native smoke: only a uniquely named private synthetic directory, never SCM.
// Bundle this entry with esbuild and execute it with Windows Node.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { privateDirectory } from '../src/files.ts';
import { acquireWriter } from '../src/lock.ts';
import { durableJson } from '../setup/io.ts';
import { windowsDurablePublish, windowsDurableReplace } from '../setup/windows/durable.ts';
import { runWindowsSetup } from '../setup/windows/runner.ts';

async function main(): Promise<void> {
  assert.equal(process.platform, 'win32', 'This smoke requires native Windows Node');
  const parent = resolve(process.env.ProgramData ?? 'C:\\ProgramData');
  const root = join(parent, 'DaifukuEdgeSetupNative-' + randomUUID());
  const link = root + '-junction';
  let release: (() => Promise<void>) | undefined;
  try {
    await privateDirectory(root);
    const marker = join(root, 'installation.json'),
      lock = join(root, '.setup-lock');
    await privateDirectory(lock);
    await durableJson(marker, { format: 1, installationId: randomUUID(), phase: 'prepared', label: '合成データ' });
    const before = await readFile(marker, 'utf8');
    assert.equal((JSON.parse(before) as { phase: string }).phase, 'prepared');
    await durableJson(marker, { format: 1, phase: 'committed', label: '合成データ' });
    assert.equal((JSON.parse(await readFile(marker, 'utf8')) as { phase: string }).phase, 'committed');
    release = await acquireWriter(lock, () => {
      throw new Error('unexpected_lock_loss');
    });
    await assert.rejects(
      acquireWriter(lock, () => undefined),
      /another_agent_is_running/,
    );
    await release();
    release = undefined;
    release = await acquireWriter(lock, () => {
      throw new Error('unexpected_lock_loss');
    });
    const staged = join(root, 'pairing.incoming.json'),
      inbox = join(root, 'pairing.json');
    await writeFile(staged, '{"synthetic":"first"}', { flag: 'wx' });
    await windowsDurablePublish(staged, inbox);
    await writeFile(staged, '{"synthetic":"second"}', { flag: 'wx' });
    await assert.rejects(
      windowsDurablePublish(staged, inbox),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'EEXIST',
    );
    assert.equal(await readFile(inbox, 'utf8'), '{"synthetic":"first"}');
    assert.equal(await readFile(staged, 'utf8'), '{"synthetic":"second"}');
    await assert.rejects(windowsDurableReplace(staged, join(lock, 'other.json')), /windows_atomic_paths_invalid/);
    await symlink(root, link, 'junction');
    await assert.rejects(
      windowsDurableReplace(join(link, 'pairing.incoming.json'), join(link, 'pairing.json')),
      /windows_reparse_path_refused/,
    );
    // A developer PC is not elevated; verify that service mutation remains unavailable.
    let administrator = true;
    try {
      await runWindowsSetup('administrator');
    } catch (error) {
      assert.match(error instanceof Error ? error.message : '', /windows_administrator_required/);
      administrator = false;
    }
    process.stdout.write(
      `Windows durable setup I/O, inbox no-overwrite and OS writer lock PASS (${process.version}; administrator=${administrator}; no SCM operations)\n`,
    );
  } finally {
    await release?.();
    await unlink(link).catch(() => undefined);
    const resolved = resolve(root);
    if (
      resolved.startsWith(parent + sep) &&
      resolved.slice(parent.length + 1).startsWith('DaifukuEdgeSetupNative-') &&
      !resolved.slice(parent.length + 1).includes(sep)
    )
      await rm(resolved, { recursive: true, force: true });
  }
}
void main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? error.message + '\n' : 'native_smoke_failed\n');
  process.exitCode = 1;
});
