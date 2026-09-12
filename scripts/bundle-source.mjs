// Export the reviewed HEAD tree only. Never include .git, untracked files or a dirty worktree.
import { execFileSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
function restricted(path) {
  return /(^|\/)(\.git|node_modules|\.data|\.runtime|backups)(\/|$)/.test(path)
    || /(^|\/)(runtime\.env|setup-state\.json|initial-admin-password\.txt)$/.test(path)
    || /(^|\/)\.env(?:$|\.)/.test(path) && !path.endsWith('.example')
    || /\.(dump|pgdump|pem|key|p12|pfx|log|zip|tar|gz)$/.test(path);
}
function main() {
  if (process.argv.length > 3) throw new Error('usage: node scripts/bundle-source.mjs [output-directory]');
  if (git('diff', '--name-only').trim() || git('diff', '--cached', '--name-only').trim()) throw new Error('Commit or restore tracked changes before exporting. Only the reviewed HEAD is distributed.');
  const paths = git('ls-tree', '-rz', '--name-only', 'HEAD').split('\0').filter(Boolean);
  if (paths.some(restricted)) throw new Error('Refusing archive: HEAD tracks a restricted runtime, backup, credential or archive path.');
  const sha = git('rev-parse', '--short=12', 'HEAD').trim();
  const out = resolve(process.argv[2] ?? join(repo, 'dist', 'releases'));
  const destination = join(out, `DaifukuERP-${sha}.zip`);
  if (existsSync(destination)) throw new Error('Refusing to replace an existing source archive.');
  mkdirSync(out, { recursive: true });
  const temporary = mkdtempSync(join(out, '.source-bundle-'));
  const archive = join(temporary, 'source.zip');
  try {
    git('archive', '--format=zip', `--prefix=DaifukuERP-${sha}/`, `--output=${archive}`, 'HEAD');
    linkSync(archive, destination); // same filesystem; fails atomically if the destination appeared meanwhile
  } finally { rmSync(archive, { force: true }); rmdirSync(temporary); }
  process.stdout.write(`${destination}\n`);
}
try { main(); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : 'Source export failed'}\n`); process.exitCode = 1; }
