import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTED_MUTANTS, validateMutationReport } from './report.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
try {
  if (process.argv.length !== 2) throw new Error('This checker accepts only the full configured mutation run');
  const report = JSON.parse(await readFile(resolve(root, 'coverage/mutation/mutation.json'), 'utf8'));
  const sources = Object.fromEntries(await Promise.all(Object.keys(EXPECTED_MUTANTS).map(async (path) => [path, await readFile(resolve(root, path), 'utf8')])));
  const count = validateMutationReport(report, sources);
  console.log(`Mutation evidence: ${count} killed, 0 survivors, 0 timeouts; current full source and inventory verified.`);
} catch (error) { console.error(`Mutation evidence rejected: ${error.message}`); process.exitCode = 1; }
