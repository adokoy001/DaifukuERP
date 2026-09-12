import assert from 'node:assert/strict';
import { describe, it, expect } from 'vitest';
import { consolidate, type CompanySource, type GroupMapping } from '../src/index.ts';
const rows = [{ accountId: 'asset', code: 'A', name: 'Cash', type: 'asset', openingDebit: '0', openingCredit: '0', periodDebit: '100', periodCredit: '0', closingBalance: '100' }, { accountId: 'revenue', code: 'R', name: 'Revenue', type: 'revenue', openingDebit: '0', openingCredit: '0', periodDebit: '0', periodCredit: '100', closingBalance: '-100' }];
const source: CompanySource = { companyId: 'company', code: 'C', name: 'Company', currency: 'JPY', closed: true, revision: '1', rows };
const mapping: GroupMapping[] = rows.map((row) => ({ companyId: 'company', accountId: row.accountId, groupCode: row.code, groupName: row.name, groupType: row.type as GroupMapping['groupType'] }));
describe('consolidation worksheet arithmetic', () => {
 it('rejects individually unbalanced eliminations even when another adjustment would offset them', () => { expect(() => consolidate([source], mapping, [{ key: 'one', kind: 'elimination', description: 'wrong', lines: [{ groupCode: 'R', debit: '11', credit: '0' }, { groupCode: 'A', debit: '0', credit: '10' }] }, { key: 'two', kind: 'adjustment', description: 'wrong', lines: [{ groupCode: 'R', debit: '9', credit: '0' }, { groupCode: 'A', debit: '0', credit: '10' }] }])).toThrow('Adjustment is not balanced'); });
 it('rejects duplicate/foreign mappings and fractional JPY adjustments', () => { expect(() => consolidate([source], [...mapping, required(mapping[0])], [])).toThrow('Duplicate'); expect(() => consolidate([source], [...mapping, { ...required(mapping[0]), companyId: 'foreign' }], [])).toThrow('outside'); expect(() => consolidate([source], mapping, [{ key: 'fraction', kind: 'adjustment', description: 'invalid JPY', lines: [{ groupCode: 'A', debit: '0.1', credit: '0' }, { groupCode: 'R', debit: '0', credit: '0.1' }] }])).toThrow('Invalid adjustment'); });
});

function required<T>(value: T | null | undefined): T { assert(value !== null && value !== undefined); return value; }
