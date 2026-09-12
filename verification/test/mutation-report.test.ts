import { describe, expect, it } from 'vitest';
import { TEST_COMMAND, validateMutationReport } from '../mutation/report.mjs';

const inventory = { 'sample.ts': 2 }, sources = { 'sample.ts': 'return left + right;\n' };
const failureEvidence = 'FAIL kernel/test/decimal.test.ts > comparison\nTest Files 1 failed | 3 passed (4)\nTests 1 failed | 20 passed (21)\n';
const fixture = () => ({ schemaVersion: '1.0', framework: { name: 'StrykerJS', version: '10.0.0' }, config: { testRunner: 'command', commandRunner: { command: TEST_COMMAND }, mutate: ['sample.ts'] }, files: { 'sample.ts': { source: sources['sample.ts'], mutants: ['0', '1'].map((id) => ({ id, status: 'Killed', statusReason: failureEvidence })) } } });

describe('AC-6 mutation evidence must fail closed', () => {
  it('accepts complete current evidence with every mutation killed', () => {
    expect(validateMutationReport(fixture(), sources, inventory)).toBe(2);
  });
  it('rejects survivors, timeouts, errors and unexecuted mutations', () => {
    for (const status of ['Survived', 'Timeout', 'RuntimeError', 'CompileError', 'NoCoverage', 'Ignored', 'Pending']) {
      const report = fixture(); report.files['sample.ts'].mutants = report.files['sample.ts'].mutants.map((mutant) => ({ ...mutant, status }));
      expect(() => validateMutationReport(report, sources, inventory)).toThrow('not killed');
    }
  });
  it('rejects stale source, partial inventory, duplicate ids and alternate runners', () => {
    expect(() => validateMutationReport(fixture(), { 'sample.ts': 'return 0;' }, inventory)).toThrow('Stale');
    const partial = fixture(); partial.files['sample.ts'].mutants.pop();
    expect(() => validateMutationReport(partial, sources, inventory)).toThrow('inventory');
    const duplicate = fixture(); duplicate.files['sample.ts'].mutants = duplicate.files['sample.ts'].mutants.map((mutant) => ({ ...mutant, id: '0' }));
    expect(() => validateMutationReport(duplicate, sources, inventory)).toThrow('duplicate');
    const alternate = fixture(); alternate.config.testRunner = 'vitest';
    expect(() => validateMutationReport(alternate, sources, inventory)).toThrow('runner');
    const wrongScope = fixture(); wrongScope.config.mutate = ['sample.ts:1:0-1:5'];
    expect(() => validateMutationReport(wrongScope, sources, inventory)).toThrow('scope');
    expect(() => validateMutationReport({ ...fixture(), files: {} }, sources, inventory)).toThrow('scope');
    expect(() => validateMutationReport({ ...fixture(), framework: { name: 'other' } }, sources, inventory)).toThrow('engine');
  });
  it('rejects Killed caused by startup failures, no tests, partial execution or unhandled errors', () => {
    for (const statusReason of ['', 'pnpm: command not found', 'FATAL ERROR: out of memory', 'Test Files 1 failed (1)\nTests no tests', failureEvidence.replace('20 passed (21)', '19 passed (20)'), failureEvidence.replace('FAIL kernel/test/decimal.test.ts > comparison', 'FAIL unrelated.test.ts > error'), failureEvidence + 'Unhandled Errors', failureEvidence + 'Test timed out in 5000ms', failureEvidence + 'Hook timed out in 10000ms']) {
      const report = fixture(); report.files['sample.ts'].mutants = report.files['sample.ts'].mutants.map((mutant) => ({ ...mutant, statusReason }));
      expect(() => validateMutationReport(report, sources, inventory)).toThrow('failing-test evidence');
    }
  });
});
