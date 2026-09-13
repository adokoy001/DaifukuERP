import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { affectedEntries, validateLedger } from '../verification/assurance.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const document = resolve(root, 'docs/verification/invariants.md');
try {
  const entries = validateLedger(readFileSync(document, 'utf8'), { root, document });
  if (process.argv[2] === '--changed') {
    const base = process.argv[3];
    if (!base || !/^[a-zA-Z0-9][a-zA-Z0-9_./~-]*$/.test(base) || process.argv.length !== 4)
      throw new Error('Use --changed <existing git ref>');
    const commit = execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const tracked = execFileSync('git', ['diff', '--name-only', '-z', commit, '--'], { cwd: root, encoding: 'utf8' });
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
      cwd: root,
      encoding: 'utf8',
    });
    const changed = [...new Set([...tracked.split('\0'), ...untracked.split('\0')].filter(Boolean))];
    console.log(
      `Recheck these linked invariant assumptions: ${affectedEntries(entries, changed, { root, document }).join(', ') || '(none)'}`,
    );
    console.log(
      'This reports linked file changes; it does not infer semantic validity or replace review of dependency changes.',
    );
  } else if (process.argv.length !== 2) throw new Error('Use no arguments, or --changed <existing git ref>');
  console.log(
    `Assurance ledger: ${entries.length} unique conditions, required assumptions and local references verified.`,
  );
} catch (error) {
  console.error(`Assurance ledger check failed: ${error.message}`);
  process.exitCode = 1;
}
