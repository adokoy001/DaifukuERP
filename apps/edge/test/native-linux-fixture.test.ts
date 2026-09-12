import { describe, expect, it, vi } from 'vitest';
import { linuxPathDiagnostics, normalizeLinuxFixture } from './native-linux-fixture.mjs';
const guard = { platform: 'linux', githubActions: 'true', explicit: true, uid: 0 };
function fixture(mode = 0o777, uid = 0, linked = false) {
  const row = { mode, uid, gid: 0, dev: 1, ino: 10, isDirectory: () => true, isSymbolicLink: () => linked, isFile: () => false };
  const io = { lstat: vi.fn(async () => ({ ...row })), chmod: vi.fn(async (_path: string, value: number) => { row.mode = value; }) };
  return { io, row };
}
describe('disposable Linux native fixture preparation', () => {
  it('changes only the root-owned /opt mode 0777 and verifies the same directory after chmod', async () => {
    const f = fixture();
    expect(await normalizeLinuxFixture(guard, f.io)).toMatchObject({ operation: 'chmod_nonrecursive_0755', before: { mode: '0777' }, after: { mode: '0755' } });
    expect(f.io.chmod.mock.calls).toEqual([['/opt', 0o755]]); expect(f.io.lstat.mock.calls).toEqual([['/opt'], ['/opt']]);
  });
  it('leaves an already protected root-owned /opt unchanged', async () => {
    const f = fixture(0o755); expect(await normalizeLinuxFixture(guard, f.io)).toMatchObject({ operation: 'unchanged' }); expect(f.io.chmod).not.toHaveBeenCalled();
  });
  it.each([{ ...guard, uid: 1000 }, { ...guard, explicit: false }, { ...guard, githubActions: undefined }, { ...guard, platform: 'darwin' }])('rejects missing disposable root guard before inspecting a path', async (input) => {
    const f = fixture(); await expect(normalizeLinuxFixture(input, f.io)).rejects.toThrow('disposable_linux_root_fixture_required'); expect(f.io.lstat).not.toHaveBeenCalled(); expect(f.io.chmod).not.toHaveBeenCalled();
  });
  it.each([{ mode: 0o777, uid: 1001, linked: false }, { mode: 0o777, uid: 0, linked: true }, { mode: 0o775, uid: 0, linked: false }, { mode: 0o1777, uid: 0, linked: false }])('does not normalize an unrecognized owner/type/mode', async ({ mode, uid, linked }) => {
    const f = fixture(mode, uid, linked); await expect(normalizeLinuxFixture(guard, f.io)).rejects.toThrow(/unexpected_runner_opt/); expect(f.io.chmod).not.toHaveBeenCalled();
  });
  it('rejects a directory replacement during the narrowly scoped mode change', async () => {
    const f = fixture(); f.io.chmod.mockImplementation(async () => { f.row.mode = 0o755; f.row.ino = 11; });
    await expect(normalizeLinuxFixture(guard, f.io)).rejects.toThrow('runner_opt_normalization_not_confirmed');
  });
  it('diagnostics expose fixed source labels and metadata without source paths or error text', async () => {
    const f = fixture(); f.io.lstat.mockRejectedValueOnce({ code: 'EACCES', message: 'private diagnostic detail' });
    const rows = await linuxPathDiagnostics({ directory: '/private-input/bundle', node: '/private-input/node', setup: '/private-input/setup' }, f.io.lstat);
    expect(rows[0]).toEqual({ label: '/', code: 'stat_unavailable' });
    expect(rows).toContainEqual({ label: 'source-node', type: 'directory', uid: 0, gid: 0, mode: '0777' });
    expect(JSON.stringify(rows)).not.toContain('/private-input'); expect(JSON.stringify(rows)).not.toContain('private diagnostic detail');
  });
});
