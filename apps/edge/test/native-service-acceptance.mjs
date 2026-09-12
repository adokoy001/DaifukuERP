// Destructive OS-service acceptance is deliberately restricted to disposable GitHub runners.
// Never run against a developer machine. No service/account/data directories are recursively deleted.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { basename, dirname, join, resolve } from 'node:path';
import { chown, chmod, lstat, mkdir, open, readFile, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
const execute = promisify(execFile);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const { values } = parseArgs({ strict: true, options: { bundle: { type: 'string' }, 'update-bundle': { type: 'string' }, 'allow-disposable-service': { type: 'boolean' } } });
if (process.env.GITHUB_ACTIONS !== 'true' || values['allow-disposable-service'] !== true) throw new Error('disposable_github_runner_and_explicit_service_guard_required');
if (!values.bundle || !values['update-bundle']) throw new Error('two_verified_bundle_directories_required');
if (!['linux', 'darwin', 'win32'].includes(process.platform)) throw new Error('unsupported_native_runner');
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
async function command(file, args, allowFailure = false, input) {
  try { const task = execute(file, args, { windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024, env: { ...process.env, PSModulePath: join(dirname(powershell), 'Modules') } }); if (input !== undefined) task.child.stdin.end(JSON.stringify(input) + '\n'); return { ok: true, code: 0, ...(await task) }; }
  catch (error) { if (allowFailure) return { ok: false, code: error.code, stdout: typeof error.stdout === 'string' ? error.stdout : '', stderr: '' }; const code = typeof error.stderr === 'string' && /^[a-z][a-z0-9_]+\s*$/.test(error.stderr) ? error.stderr.trim() : 'native_command_failed'; throw new Error(code === 'native_command_failed' && Number.isInteger(error.code) ? code + '_exit_' + error.code : code); }
}
async function ps(script, input) { return command(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], false, input); }
async function exists(path) { try { const stat = await lstat(path); if (stat.isSymbolicLink()) throw new Error('native_test_path_link'); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function regular(path) { const stat = await lstat(path); assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'ordinary native fixture file required'); return readFile(path); }
async function files(directory, prefix = '') {
  const found = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    assert(entry.isFile() || entry.isDirectory(), 'bundle links forbidden');
    const name = prefix + entry.name;
    found.push(...(entry.isDirectory() ? await files(directory, name + '/') : [name]));
  }
  return found.sort();
}
async function bundle(path) {
  const directory = resolve(path), raw = await regular(join(directory, 'manifest.json'));
  const hash = (await regular(join(dirname(directory), basename(directory) + '.manifest.sha256'))).toString().trim();
  assert.match(hash, /^[a-f0-9]{64}$/); assert.equal(digest(raw), hash);
  const manifest = JSON.parse(raw.toString());
  assert.equal(manifest.kind, 'daifuku-edge-bundle'); assert.equal(manifest.format, 1);
  assert.equal(manifest.platform, process.platform); assert.equal(manifest.arch, process.arch); assert.equal(manifest.nodeVersion, '22.23.2');
  assert.match(manifest.releaseId, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/);
  const paths = manifest.files.map((row) => row.path); assert.equal(new Set(paths).size, paths.length);
  for (const row of manifest.files) {
    assert.match(row.path, /^[a-zA-Z0-9._/-]+$/); assert(row.path.split('/').every((part) => part && part !== '.' && part !== '..'));
    const data = await regular(join(directory, row.path)); assert.equal(data.length, row.bytes); assert.equal(digest(data), row.sha256);
  }
  assert.deepEqual(await files(directory), [...paths, 'manifest.json'].sort());
  for (const required of ['runtime/' + (process.platform === 'win32' ? 'node.exe' : 'node'), 'setup/setup.mjs', 'app/edge.mjs', 'LICENSE', 'THIRD_PARTY_NOTICES.txt']) assert(paths.includes(required));
  return { directory, hash, manifest, node: join(directory, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'), setup: join(directory, 'setup/setup.mjs') };
}
const defaults = process.platform === 'win32'
  ? { root: join(process.env.ProgramFiles ?? 'C:\\Program Files', 'DaifukuEdge'), state: join(process.env.ProgramData ?? 'C:\\ProgramData', 'DaifukuEdge') }
  : process.platform === 'linux' ? { root: '/opt/daifuku-edge', state: '/var/lib/daifuku-edge' }
  : { root: '/Library/Application Support/DaifukuEdge', state: '/Library/Application Support/DaifukuEdgeData' };
const markerPath = join(defaults.root, 'installation.json');
const initial = await bundle(values.bundle), update = await bundle(values['update-bundle']);
assert.notEqual(initial.hash, update.hash); assert.notEqual(initial.manifest.releaseId, update.manifest.releaseId);
assert.equal((await command(initial.node, ['--version'])).stdout.trim(), 'v22.23.2');
async function assertNoNativeServiceAndAccount() {
if (process.platform === 'win32') {
  const admin = await ps("$p = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()); if (!$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 1 }; if (Get-Service -Name DaifukuEdge -ErrorAction SilentlyContinue) { exit 2 }; [Console]::Out.WriteLine('clean_admin')");
  assert.equal(admin.stdout.trim(), 'clean_admin');
} else {
  assert.equal(process.getuid(), 0, 'root process required');
  if (process.platform === 'linux') {
    const service = await command('/usr/bin/systemctl', ['show', 'daifuku-edge.service', '--property=LoadState', '--value'], true);
    assert([0, 4].includes(service.code)); assert.equal(service.stdout.trim(), 'not-found');
    assert.equal((await command('/usr/bin/id', ['-u', 'daifuku-edge'], true)).ok, false);
  } else {
    assert.equal((await command('/bin/launchctl', ['print', 'system/jp.daifuku.edge'], true)).ok, false);
    assert.equal((await command('/usr/bin/dscl', ['.', '-read', '/Users/_daifukuedge'], true)).ok, false);
  }
}
}
await assertNoNativeServiceAndAccount();
assert.equal(await exists(defaults.root), false, 'existing installation is never adopted by acceptance');
assert.equal(await exists(defaults.state), false, 'existing state is never adopted by acceptance');
const fixtureRoot = process.platform === 'win32' ? join(process.env.ProgramData ?? 'C:\\ProgramData', 'DaifukuEdgeAcceptance-' + randomUUID()) : (process.platform === 'darwin' ? '/private/var/' : '/var/') + 'daifuku-edge-acceptance-' + randomUUID();
if (process.platform === 'win32') {
  await ps(`$ErrorActionPreference='Stop'; $path=([Console]::In.ReadLine()|ConvertFrom-Json).path;
$s=[Security.AccessControl.DirectorySecurity]::new(); $s.SetAccessRuleProtection($true,$false);
foreach($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')|Select-Object -Unique){$s.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))};
[void][IO.Directory]::CreateDirectory($path,$s)`, { path: fixtureRoot });
} else await mkdir(fixtureRoot, { mode: 0o700 });
const apiBaseUrl = 'https://erp.example.invalid', configSource = join(fixtureRoot, 'config.json');
async function exclusive(path, value, owner) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  if (process.platform !== 'win32') { if (owner) await chown(path, owner.uid, owner.gid); await chmod(path, 0o600); }
}
await exclusive(configSource, { apiBaseUrl, devices: [] });
const common = ['--install-root', defaults.root];
async function setup(source, operation, args = []) {
  const result = await command(source.node, [source.setup, operation, ...common, ...args]); return JSON.parse(result.stdout);
}
const deployArgs = (source) => ['--bundle', source.directory, '--manifest-sha256', source.hash];
async function waitStatus(check, source = initial, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const status = await setup(source, 'status'); if (check(status)) return status; await delay(1000); }
  throw new Error('native_service_state_timeout');
}
async function ownMarker() {
  const marker = await json(markerPath);
  assert.equal(marker.kind, 'daifuku-edge-installation'); assert.equal(marker.platform, process.platform); assert.equal(marker.arch, process.arch);
  assert.equal(marker.installRoot, defaults.root); assert.equal(marker.statePath, defaults.state); assert.match(marker.installationId, /^[a-f0-9-]{36}$/);
  return marker;
}
async function diagnostics(source) {
  const report = { stage, platform: process.platform };
  try {
    const status = await setup(source, 'status');
    report.setup = { serviceExists: status.serviceExists, serviceOwned: status.serviceOwned, serviceRunning: status.serviceRunning, runtimeStatusFresh: status.runtimeStatusFresh, conflicts: status.conflicts };
  } catch (error) { report.setupCode = /^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'status_unavailable'; }
  try {
    const runtime = await json(join(defaults.state, 'service-status.json'));
    report.runtime = { pid: Number.isInteger(runtime.pid) ? runtime.pid : null, phase: ['pairing_required', 'connecting', 'running', 'credential_rejected', 'stopped', 'error'].includes(runtime.phase) ? runtime.phase : 'invalid', observedAt: /^\d{4}-\d\d-\d\dT[0-9:.]+Z$/.test(runtime.observedAt) ? runtime.observedAt : null };
  } catch { report.runtime = null; }
  try {
    if (process.platform === 'win32') {
      const native = await ps("$s=Get-CimInstance Win32_Service -Filter \"Name='DaifukuEdge'\"; if($s){[Console]::Out.WriteLine(($s|Select-Object Name,State,ProcessId,ExitCode,StartMode,StartName|ConvertTo-Json -Compress))}else{[Console]::Out.WriteLine('{}')}");
      report.native = JSON.parse(native.stdout);
    } else if (process.platform === 'linux') {
      const native = await command('/usr/bin/systemctl', ['show', 'daifuku-edge.service', '--property=LoadState,ActiveState,SubState,Result,ExecMainPID,ExecMainStatus,User,Group']);
      report.native = Object.fromEntries(native.stdout.trim().split('\n').filter((line) => /^[A-Za-z]+=[a-zA-Z0-9_.-]*$/.test(line)).map((line) => line.split('=')));
    } else {
      const native = await command('/bin/launchctl', ['print', 'system/jp.daifuku.edge'], true);
      report.native = { loaded: native.ok, fields: native.stdout.split('\n').map((line) => line.trim()).filter((line) => /^(state|pid|last exit code|username|group) = [a-zA-Z0-9_. -]+$/.test(line)) };
    }
  } catch { report.native = { code: 'native_status_unavailable' }; }
  process.stderr.write(JSON.stringify({ type: 'native_acceptance_diagnostics', ...report }) + '\n');
}
let installationId, activeSource = initial, stage = 'plan', installed = false;
try {
  const plan = await setup(initial, 'install', [...deployArgs(initial), '--config', configSource]);
  assert.equal(plan.execute, false); assert.equal(await exists(defaults.root), false); assert.equal(await exists(defaults.state), false); await assertNoNativeServiceAndAccount();
  stage = 'install'; await setup(initial, 'install', [...deployArgs(initial), '--config', configSource, '--execute']);
  const marker = await ownMarker(); installationId = marker.installationId; installed = true;
  assert.equal(marker.active.manifestHash, initial.hash); assert.equal(marker.status, 'installed');
  const first = await waitStatus((status) => status.serviceOwned && status.serviceRunning && status.runtimeStatusFresh && status.runtime?.phase === 'pairing_required');
  assert(first.account); process.stdout.write('native_install_pairing_required_passed\n');
  stage = 'stop'; await setup(initial, 'stop', ['--execute']); await waitStatus((status) => !status.serviceRunning);
  const stateOwner = await lstat(defaults.state);
  await exclusive(join(defaults.state, 'credentials.json'), { apiBaseUrl }, stateOwner);
  await exclusive(join(defaults.state, 'journal.json'), { version: 1, records: [], events: [] }, stateOwner);
  const preserved = {};
  for (const name of ['config.json', 'credentials.json', 'journal.json']) preserved[name] = digest(await regular(join(defaults.state, name)));
  stage = 'start'; const startedAt = Date.now(); await setup(initial, 'start', ['--execute']);
  const restarted = await waitStatus((status) => status.serviceRunning && status.runtimeStatusFresh && status.runtime?.phase === 'pairing_required' && Date.parse(status.runtime.observedAt) >= startedAt);
  assert.notEqual(restarted.runtime.pid, first.runtime.pid); process.stdout.write('native_stop_start_passed\n');
  stage = 'update_plan';
  const beforeMarker = digest(await regular(markerPath));
  const updatePlan = await setup(update, 'update', deployArgs(update)); assert.equal(updatePlan.execute, false);
  assert.equal(digest(await regular(markerPath)), beforeMarker); assert.equal(await exists(join(defaults.root, 'releases', update.manifest.releaseId + '-' + update.hash.slice(0, 16))), false);
  stage = 'update'; const updatedAt = Date.now(); await setup(update, 'update', [...deployArgs(update), '--execute']); activeSource = update;
  const updated = await ownMarker(); assert.equal(updated.installationId, installationId); assert.equal(updated.active.manifestHash, update.hash); assert.notEqual(updated.active.context.releaseDir, marker.active.context.releaseDir);
  await waitStatus((status) => status.serviceRunning && status.runtimeStatusFresh && status.runtime?.phase === 'pairing_required' && Date.parse(status.runtime.observedAt) >= updatedAt, update);
  for (const [name, hash] of Object.entries(preserved)) assert.equal(digest(await regular(join(defaults.state, name))), hash);
  assert.equal(await exists(marker.active.context.releaseDir), true); process.stdout.write('native_update_preserves_private_state_passed\n');
  stage = 'uninstall'; await setup(update, 'uninstall', ['--execute']);
  const removed = await setup(update, 'status'); assert.equal(removed.serviceExists, false); assert.equal(removed.serviceRunning, false); assert.deepEqual(removed.account, first.account);
  assert.equal((await ownMarker()).status, 'uninstalled');
  for (const [name, hash] of Object.entries(preserved)) assert.equal(digest(await regular(join(defaults.state, name))), hash);
  assert.equal(await exists(updated.active.context.releaseDir), true); assert.equal(await exists(marker.active.context.releaseDir), true);
  installed = false; process.stdout.write('native_uninstall_retains_account_data_releases_passed\n');
} catch (error) {
  process.stderr.write('native_acceptance_failed_at_' + stage + '\n'); await diagnostics(activeSource);
  // CLI rechecks the marker and real service registration before cleanup. Never remove unknown partial ownership.
  if (installed && installationId) {
    try {
      const marker = await ownMarker(); assert.equal(marker.installationId, installationId);
      assert.equal(marker.pending, undefined); assert([initial.hash, update.hash].includes(marker.active.manifestHash));
      const status = await setup(activeSource, 'status');
      if (status.serviceExists && status.serviceOwned && status.conflicts.length === 0) await setup(activeSource, 'uninstall', ['--execute']);
      process.stderr.write('verified_native_service_cleanup_finished_data_retained\n');
    } catch { process.stderr.write('native_cleanup_requires_review_on_disposable_runner\n'); }
  }
  throw error;
}
