import { dirname, join } from 'node:path';
import type { ServiceContext } from '../setup/types.js';
import type { CommandResult, FileInfo, PosixHost } from '../setup/posix/host.js';
import { linuxUnitPath } from '../setup/posix/service-linux.js';
import { macPlistPath } from '../setup/posix/service-mac.js';
import { ownershipTag } from '../setup/posix/render.js';
interface Entry extends FileInfo { text: string; acl?: boolean }
export class PosixFixture implements PosixHost {
  files = new Map<string, Entry>();
  changes: string[] = [];
  commands: string[][] = [];
  user: Record<string, string> | null = null;
  loaded: string | null = null;
  running = false;
  dropIns = '';
  groupId = 65534;
  extraGroup = false;
  uidValue = 0;
  failAt = '';
  context: ServiceContext;
  constructor(public platform: 'linux' | 'darwin') {
    const installRoot = platform === 'linux' ? '/opt/daifuku-edge' : '/Library/Application Support/DaifukuEdge';
    const statePath = platform === 'linux' ? '/var/lib/daifuku-edge' : '/Library/Application Support/DaifukuEdgeData';
    const releaseDir = join(installRoot, 'releases/v1');
    this.context = { platform, installationId: '11111111-2222-4333-8444-555555555555', installRoot, statePath, releaseDir, nodePath: join(releaseDir, 'runtime/node'), appPath: join(releaseDir, 'app/edge.mjs'), configPath: join(statePath, 'config.json'), logPath: join(statePath, 'logs'), servicePath: join(installRoot, 'service') };
    for (const path of [installRoot, dirname(statePath), dirname(linuxUnitPath), dirname(macPlistPath)]) this.directoryTree(path);
    const rootEntry = this.files.get(installRoot); if (rootEntry) rootEntry.mode = 0o700;
    this.put(join(installRoot, 'installation.json'), JSON.stringify(this.context), 0, 0o600);
  }
  uid = () => this.uidValue;
  directoryTree(path: string): void { if (path !== '/') this.directoryTree(dirname(path)); if (!this.files.has(path)) this.files.set(path, { kind: 'directory', uid: 0, gid: 0, mode: 0o755, links: 1, text: '' }); }
  put(path: string, text: string, uid: number, mode = 0o600): void { this.files.set(path, { kind: 'file', uid, gid: uid === 0 ? 0 : this.groupId, mode, links: 1, text }); }
  stat = async (path: string) => this.files.get(path) ?? null;
  read = async (path: string) => { const entry = this.files.get(path); if (!entry) throw new Error('Missing fixture file'); return entry.text; };
  write = async (path: string, text: string, mode: number) => { if (this.files.has(path)) throw new Error('EEXIST'); this.put(path, text, 0, mode); this.changes.push('write:' + path); };
  rename = async (from: string, to: string) => { const entry = this.files.get(from); if (!entry) throw new Error('Missing temporary fixture file'); this.files.set(to, entry); this.files.delete(from); this.changes.push('rename:' + to); };
  remove = async (path: string) => { this.files.delete(path); this.changes.push('remove:' + path); };
  mkdir = async (path: string, mode: number) => { if (this.files.has(path)) throw new Error('EEXIST'); this.files.set(path, { kind: 'directory', uid: 0, gid: 0, mode, links: 1, text: '' }); this.changes.push('mkdir:' + path); };
  list = async (path: string) => [...this.files.keys()].filter((entry) => entry !== path && dirname(entry) === path).map((entry) => entry.slice(path.length + 1));
  chmod = async (path: string, mode: number) => { const entry = this.files.get(path); if (!entry) throw new Error('Missing fixture path'); entry.mode = mode; this.changes.push('chmod:' + path); };
  chown = async (path: string, uid: number, gid: number) => { const entry = this.files.get(path); if (!entry) throw new Error('Missing fixture path'); entry.uid = uid; entry.gid = gid; this.changes.push('chown:' + path); };
  wait = async () => undefined;
  run = async (executable: string, args: string[]): Promise<CommandResult> => {
    this.commands.push([executable, ...args]);
    const command = args.join(' ');
    if (this.failAt && command.includes(this.failAt)) throw new Error('Injected operation failure');
    if (executable === '/bin/ls') return this.ok(`drwx------${this.files.get(args[1] ?? '')?.acl ? '+' : ''} 1 root wheel 0 path`);
    if (executable === '/bin/chmod') { const entry = this.files.get(args[1] ?? ''); if (entry) entry.acl = false; this.changes.push('acl:' + args[1]); return this.ok(); }
    if (executable === '/usr/bin/getent') return this.getent(args);
    if (executable === '/usr/bin/id') return this.user ? this.ok(args[0] === '-G' ? String(this.groupId) + (this.extraGroup ? ' 0' : '') : this.user.UniqueID ?? '') : { code: 1, stdout: '', stderr: 'no such user' };
    if (executable === '/usr/sbin/useradd') { this.user = { UniqueID: '401', RealName: ownershipTag(this.context), Password: '!' }; this.changes.push('create-account'); return this.ok(); }
    if (executable === '/usr/bin/dscl') return this.dscl(args);
    if (executable === '/usr/bin/systemctl') return this.systemctl(args);
    if (executable === '/bin/launchctl') return this.launchctl(args);
    if (executable === '/usr/bin/plutil') return this.ok();
    throw new Error('Unexpected fixture command: ' + executable);
  };
  private ok(stdout = ''): CommandResult { return { code: 0, stdout, stderr: '' }; }
  private getent(args: string[]): CommandResult {
    if (args[0] === 'group') return this.ok(`${args[1]}:x:${this.groupId}:`);
    if (!this.user) return { code: 2, stdout: '', stderr: '' };
    if (args[0] === 'shadow') return this.ok(`daifuku-edge:${this.user.Password}:0:0:99999:7:::`);
    return this.ok(`daifuku-edge:x:${this.user.UniqueID}:${this.groupId}:${this.user.RealName}:/nonexistent:/usr/sbin/nologin`);
  }
  private dscl(args: string[]): CommandResult {
    if (args[0] === '/Search') return this.ok(`root 0\n_reserved 400\n${this.user?.UniqueID ? '_daifukuedge ' + this.user.UniqueID : ''}`);
    if (args[1] === '-list') return this.ok('root\n' + (this.user ? '_daifukuedge' : ''));
    if (args[2] === '/Groups/nobody') return this.ok('PrimaryGroupID: ' + this.groupId);
    if (args[1] === '-read') return this.ok(Object.entries(this.user ?? {}).map(([key, value]) => (key === 'IsHidden' ? 'dsAttrTypeNative:IsHidden' : key) + ': ' + value).join('\n'));
    if (args[1] === '-create') { this.user ??= {}; this.user[args[3] ?? ''] = args[4] ?? ''; this.changes.push('dscl:' + args[3]); return this.ok(); }
    throw new Error('Unexpected dscl fixture call');
  }
  private systemctl(args: string[]): CommandResult {
    if (args[0] === 'show') {
      const body = this.files.get(linuxUnitPath)?.text;
      return this.ok(`LoadState=${this.loaded ? 'loaded' : 'not-found'}\nActiveState=${this.running ? 'active' : 'inactive'}\nSubState=${this.running ? 'running' : 'dead'}\nFragmentPath=${this.loaded ? linuxUnitPath : ''}\nDropInPaths=${this.dropIns}\nTransient=no\nNeedDaemonReload=${this.loaded && body !== this.loaded ? 'yes' : 'no'}\nUser=${this.loaded ? 'daifuku-edge' : ''}\nGroup=${this.loaded ? 'nogroup' : ''}\nMainPID=${this.running ? '12345' : '0'}`);
    }
    this.changes.push('systemctl:' + args[0]);
    if (args[0] === 'daemon-reload') this.loaded = this.files.get(linuxUnitPath)?.text ?? null;
    if (args[0] === 'start') this.running = true;
    if (args[0] === 'stop') this.running = false;
    return this.ok();
  }
  private launchctl(args: string[]): CommandResult {
    if (args[0] === 'print') {
      if (!this.loaded) return { code: 113, stdout: '', stderr: 'Could not find service "jp.daifuku.edge" in domain for system' };
      const values = (this.loaded.match(/<key>ProgramArguments<\/key><array>(.*?)<\/array>/)?.[1]?.match(/<string>(.*?)<\/string>/g) ?? []).map((value) => value.slice(8, -9));
      const ca = this.loaded.match(/<key>NODE_EXTRA_CA_CERTS<\/key><string>(.*?)<\/string>/)?.[1];
      return this.ok(`system/jp.daifuku.edge = {\n path = ${macPlistPath}\n program = ${values[0]}\n username = _daifukuedge\n group = nobody\n arguments = {\n${values.join('\n')}\n }\n${this.running ? ' pid = 12345\n' : ''}${ca ? ' NODE_EXTRA_CA_CERTS = ' + ca + '\n' : ''}}`);
    }
    this.changes.push('launchctl:' + args[0]);
    if (args[0] === 'bootstrap') { this.loaded = this.files.get(macPlistPath)?.text ?? null; this.running = true; }
    if (args[0] === 'kickstart') this.running = true;
    if (args[0] === 'bootout') { this.loaded = null; this.running = false; }
    return this.ok();
  }
  addRelease(context = this.context): void {
    const isNew = !this.files.has(join(context.installRoot, 'releases'));
    this.directoryTree(join(context.releaseDir, 'runtime'));
    this.directoryTree(join(context.releaseDir, 'app'));
    const parent = this.files.get(join(context.installRoot, 'releases')); if (isNew && parent) parent.mode = 0o700;
    this.put(context.nodePath, 'synthetic node', 0, 0o755);
    this.put(context.appPath, 'synthetic app', 0, 0o644);
    this.put(context.configPath, '{}', 0);
  }
}
