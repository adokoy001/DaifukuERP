import { stripVTControlCharacters } from 'node:util';

// Reviewed whole-file inventory for StrykerJS 10.0.0. A source/tool update must review the new inventory.
export const EXPECTED_MUTANTS = { 'kernel/src/decimal.ts': 90, 'modules/accounting/src/services/balance.ts': 57 };
export const TEST_COMMAND = 'pnpm exec vitest run --config verification/mutation/vitest.config.mts';

function completedFailingTests(reason) {
  if (typeof reason !== 'string') return false;
  const output = stripVTControlCharacters(reason).replaceAll('\r', '');
  const tests = output.match(/^\s*Tests\s+(\d+) failed(?:\s*\|\s*(\d+) passed)?\s*\((\d+)\)\s*$/m);
  const files = output.match(/^\s*Test Files\s+(\d+) failed(?:\s*\|\s*(\d+) passed)?\s*\((\d+)\)\s*$/m);
  const complete = (summary, total) => summary && Number(summary[1]) > 0 && Number(summary[1]) + Number(summary[2] ?? 0) === total && Number(summary[3]) === total;
  const namedFailure = /^\s*FAIL\s+(?:kernel\/test\/decimal(?:-reference)?|modules\/accounting\/test\/balance(?:-reference)?)\.test\.ts\s*>/m.test(output);
  // Command runner treats every nonzero exit as Killed, including startup failures. Demand completed tests.
  return complete(tests, 21) && complete(files, 4) && namedFailure && !/Unhandled Errors|Unhandled Rejection|\bErrors\s+\d+ errors?|(?:Test|Hook) timed out|Worker exited unexpectedly/.test(output);
}

export function validateMutationReport(report, sources, inventory = EXPECTED_MUTANTS) {
  const sameKeys = (a, b) => JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort());
  if (report?.schemaVersion !== '1.0' || report.framework?.name !== 'StrykerJS' || report.framework?.version !== '10.0.0') throw new Error('Unreviewed mutation report format or engine');
  if (!report.files || !sameKeys(report.files, inventory) || !sameKeys(sources, inventory)) throw new Error('Mutation scope is missing or unexpected');
  if (report.config?.testRunner !== 'command' || report.config.commandRunner?.command !== TEST_COMMAND || JSON.stringify(report.config.mutate) !== JSON.stringify(Object.keys(inventory))) throw new Error('Mutation scope or runner differs from the reviewed configuration');
  let total = 0; const ids = new Set();
  for (const [path, expected] of Object.entries(inventory)) {
    const file = report.files[path];
    if (typeof file.source !== 'string' || file.source.replaceAll('\r\n', '\n') !== sources[path].replaceAll('\r\n', '\n')) throw new Error(`Stale mutation source: ${path}`);
    if (!Array.isArray(file.mutants) || file.mutants.length !== expected) throw new Error(`Review changed mutation inventory: ${path}`);
    for (const mutant of file.mutants) {
      if (typeof mutant.id !== 'string' || ids.has(mutant.id)) throw new Error('Missing or duplicate mutant identity');
      ids.add(mutant.id);
      if (mutant.status !== 'Killed') throw new Error(`Mutation not killed: ${path} ${mutant.id} ${mutant.status}`);
      if (!completedFailingTests(mutant.statusReason)) throw new Error(`Missing completed failing-test evidence: ${path} ${mutant.id}`);
      total += 1;
    }
  }
  return total;
}
