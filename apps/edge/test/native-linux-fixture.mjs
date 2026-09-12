// Test harness only: never imported by the production installer or service.
import { chmod, lstat } from 'node:fs/promises';
const fixedAncestors = ['/', '/opt', '/var', '/var/lib', '/etc', '/etc/systemd', '/etc/systemd/system'];
const type = (stat) => stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
const detail = (stat) => ({ type: type(stat), uid: stat.uid, gid: stat.gid, mode: (stat.mode & 0o7777).toString(8).padStart(4, '0') });
// Only fixed system paths and fixed source labels reach logs, never input paths or file contents.
export async function linuxPathDiagnostics(source, readStat = lstat) {
  const targets = fixedAncestors.map((path) => ({ label: path, path }));
  if (source) targets.push({ label: 'source-directory', path: source.directory }, { label: 'source-node', path: source.node }, { label: 'source-setup', path: source.setup });
  return Promise.all(targets.map(async ({ label, path }) => {
    try { return { label, ...detail(await readStat(path)) }; }
    catch (error) { return { label, code: error.code === 'ENOENT' ? 'missing' : 'stat_unavailable' }; }
  }));
}
export async function normalizeLinuxFixture(guard, io = { lstat, chmod }) {
  if (guard.platform !== 'linux' || guard.githubActions !== 'true' || guard.explicit !== true || guard.uid !== 0) throw new Error('disposable_linux_root_fixture_required');
  const before = await io.lstat('/opt');
  if (!before.isDirectory() || before.isSymbolicLink() || before.uid !== 0) throw new Error('unexpected_runner_opt_owner_or_type');
  const mode = before.mode & 0o7777;
  if (mode !== 0o777) {
    if (mode & 0o7022) throw new Error('unexpected_runner_opt_permissions');
    return { path: '/opt', operation: 'unchanged', before: detail(before), after: detail(before) };
  }
  // The pinned Ubuntu runner image makes /opt 0777. Secure this one directory only.
  // No recursion or chown; toolcache entries and all other ancestors remain unchanged.
  await io.chmod('/opt', 0o755);
  const after = await io.lstat('/opt');
  if (!after.isDirectory() || after.isSymbolicLink() || after.uid !== 0 || (after.mode & 0o7777) !== 0o755 || after.dev !== before.dev || after.ino !== before.ino) throw new Error('runner_opt_normalization_not_confirmed');
  return { path: '/opt', operation: 'chmod_nonrecursive_0755', before: detail(before), after: detail(after) };
}
