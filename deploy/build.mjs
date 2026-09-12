import { execFileSync } from 'node:child_process';
import { cp, link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { copyRuntime } from './runtime.mjs';
import { writeWebNotices } from './web-notices.mjs';
import { digest, inventory, restrictedSource, safePath, verifyRelease } from './files.mjs';
function run(command, args, cwd, env) { return execFileSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
function buildEnvironment() {
  const env = { CI: '1', NODE_ENV: 'development', VITE_API_URL: '/api', npm_config_offline: 'true', npm_config_userconfig: '/dev/null', npm_config_globalconfig: '/dev/null', npm_config_registry: 'https://registry.npmjs.org' };
  for (const key of ['PATH', 'HOME', 'USER', 'TMPDIR', 'PNPM_HOME']) if (process.env[key]) env[key] = process.env[key];
  return env;
}
async function prepareSource(source, temporary, env) {
  const git = (...args) => run('git', ['-C', source, ...args], source, env);
  if (git('status', '--porcelain', '--untracked-files=no').trim()) throw new Error('Release source must be a clean committed tree.');
  const files = git('ls-tree', '-rz', '--name-only', 'HEAD').split('\0').filter(Boolean);
  if (files.includes('.npmrc') && git('show', 'HEAD:.npmrc').trim() !== 'auto-install-peers=true\nstrict-peer-dependencies=false') throw new Error('Only the reviewed public peer-resolution .npmrc is permitted.');
  if (files.some((path) => path !== '.npmrc' && restrictedSource(path))) throw new Error('Tracked source contains a forbidden secret or runtime path.');
  const commit = git('rev-parse', 'HEAD').trim(), stage = join(temporary, 'stage'), archive = join(temporary, 'source.tar');
  await mkdir(stage); git('archive', '--format=tar', `--output=${archive}`, 'HEAD');
  run('tar', ['-xf', archive, '--no-same-owner', '-C', stage], temporary, env);
  await inventory(stage); // Reject escaping/broken links; preserve internal tracked aliases.
  return { commit, stage };
}
export async function buildRelease({ source, output, candidate = false, progress = () => undefined }) {
  source = safePath(source); output = safePath(output);
  if (!process.version.startsWith('v22.') || process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) throw new Error('Build on the Linux target architecture.');
  const env = buildEnvironment();
  // The staging filesystem can differ (/tmp tmpfs); retain the source store explicitly.
  env.npm_config_store_dir = safePath(run('pnpm', ['store', 'path'], source, env).trim());
  const temporary = await mkdtemp(join(tmpdir(), 'daifuku-release-'));
  try {
    const { stage, commit } = await prepareSource(source, temporary, env);
    const packageInfo = JSON.parse(await readFile(join(stage, 'package.json'), 'utf8'));
    if (run('pnpm', ['--version'], stage, env).trim() !== packageInfo.packageManager?.replace(/^pnpm@/, '')) throw new Error('Use the release-pinned pnpm version.');
    const bundle = join(temporary, 'bundle'); await mkdir(bundle);
    await cp(stage, join(bundle, 'source'), { recursive: true, verbatimSymlinks: true });
    progress('offline-dependencies'); run('pnpm', ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'], stage, env);
    progress('web'); run('pnpm', ['--filter', '@daifuku/web', 'build'], stage, env);
    await writeWebNotices(stage, join(stage, 'apps/web/dist'));
    await cp(join(stage, 'apps/web/dist'), join(bundle, 'web'), { recursive: true });
    progress('api-runtime'); await copyRuntime(stage, join(bundle, 'runtime'));
    progress('edge'); run('pnpm', ['--filter', '@daifuku/edge', 'build'], stage, env);
    await mkdir(join(bundle, 'edge'));
    for (const file of ['edge.mjs', 'LICENSE', 'THIRD_PARTY_NOTICES.txt']) await cp(join(stage, 'apps/edge/dist', file), join(bundle, 'edge', file));
    const manifest = { format: 1, commit, candidate, platform: process.platform, arch: process.arch, node: process.version, packageManager: packageInfo.packageManager, apiBase: '/api', lockSha256: digest(await readFile(join(stage, 'pnpm-lock.yaml'))), files: await inventory(bundle) };
    await writeFile(join(bundle, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    const verified = await verifyRelease(bundle); progress('verify-runtime');
    run(process.execPath, ['--import', 'tsx', 'src/setup/cli.ts', '--help'], join(bundle, 'runtime/apps/api'), env);
    const packed = join(temporary, 'release.tar.gz'); run('tar', ['-czf', packed, '-C', temporary, 'bundle'], temporary, env);
    await mkdir(output, { mode: 0o700 });
    const archive = join(output, `DaifukuERP-${commit.slice(0, 12)}-${process.arch}${candidate ? '-candidate' : ''}.tar.gz`);
    await cp(packed, join(output, '.release.tmp'), { errorOnExist: true, force: false }); await link(join(output, '.release.tmp'), archive); await rm(join(output, '.release.tmp'));
    await writeFile(join(output, 'SHA256SUMS'), `${digest(await readFile(archive))}  ${archive.split('/').at(-1)}\n`, { flag: 'wx', mode: 0o600 });
    await writeFile(join(output, 'manifest.sha256'), verified.sha256 + '\n', { flag: 'wx', mode: 0o600 });
    return { archive, manifestSha256: verified.sha256, commit, candidate };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
