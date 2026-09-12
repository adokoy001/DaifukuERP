import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { affectedEntries, parseLedger, validateLedger } from '../assurance.mjs';

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'daifuku-ledger-'));
  await mkdir(join(root, 'docs'));
  await Promise.all(['source.ts', 'sample.test.ts', 'spec.md'].map(file => writeFile(join(root, file), 'fixture\n')));
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
const entry = (id = 'CORE-DEMO-001') => `## ${id}
- 条件: sum remains balanced
- 前提: approved lines only
- 仕様: [spec](../spec.md)
- 実装: [source](../source.ts#L1)
- 試験: [test](../sample.test.ts)
- 根拠: synthetic example only
- 失効条件: changing rounding or posting
- 限界: external truth is not checked
`;
const options = () => ({ root, document: join(root, 'docs/invariants.md'), minimum: 1 });

it('AC-1 validates a concrete invariant and reports linked change impact without claiming a proof', () => {
  const entries = validateLedger(entry(), options());
  expect(entries.map((item: { id: string }) => item.id)).toEqual(['CORE-DEMO-001']);
  expect(affectedEntries(entries, ['source.ts'], options())).toEqual(['CORE-DEMO-001']);
  expect(affectedEntries(entries, ['unrelated.ts'], options())).toEqual([]);
});

it('AC-1 rejects empty, duplicated and incomplete assurance claims', () => {
  expect(() => validateLedger('', options())).toThrow('At least 1');
  expect(() => validateLedger(entry() + entry(), options())).toThrow('duplicate invariant ID');
  expect(() => validateLedger(entry().replace('- 前提: approved lines only', ''), options())).toThrow('missing 前提');
  expect(() => parseLedger(entry() + '- 前提: replacement\n')).toThrow('duplicate field');
  expect(() => parseLedger(entry().replace('CORE-DEMO-001', 'broken id'))).toThrow('valid invariant ID');
});

it('AC-1 never counts a fenced example as evidence and rejects an unfinished fence', () => {
  for (const fence of ['```markdown', '~~~markdown', '````markdown']) {
    const closing = fence.replace('markdown', '');
    expect(parseLedger(fence + '\n' + entry() + closing + '\n')).toEqual([]);
    expect(() => validateLedger(fence + '\n' + entry() + closing + '\n', options())).toThrow('At least 1');
  }
  expect(() => parseLedger('```\n' + entry())).toThrow('Unclosed code fence');
});

it('AC-1 rejects missing, non-test, external, escaping and invalid line references', () => {
  for (const replacement of ['missing.ts', 'source.ts', 'https://example.invalid/test.ts', '../../outside.test.ts']) {
    expect(() => validateLedger(entry().replace('../sample.test.ts', replacement), options())).toThrow('invalid 試験');
  }
  expect(() => validateLedger(entry().replace('#L1', '#L999'), options())).toThrow('existing #L<number>');
  expect(() => validateLedger(entry().replace('#L1', '#missing-heading'), options())).toThrow('existing #L<number>');
});

it('AC-1 rejects a reference whose symlink resolves outside the repository', async () => {
  await symlink(tmpdir(), join(root, 'outside'), 'junction');
  expect(() => validateLedger(entry().replace('../source.ts#L1', '../outside'), options())).toThrow('invalid 実装');
});
