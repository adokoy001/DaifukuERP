import { defineEntity, f, label } from '@daifuku/kernel';
import type { CompanySource, GroupMapping, GroupAdjustment, GroupResult } from './contract.ts';
const owned = { serverOwned: true },
  privateSource = { serverOwned: true, hidden: true, outputHidden: true };
export const GroupRun = defineEntity({
  name: 'group_accounting_run',
  label: label('連結精算表', 'Consolidation worksheet'),
  ext: false,
  fields: {
    name: f.text({ ...owned, required: true, maxLength: 100 }),
    from: f.date({ ...owned, required: true }),
    to: f.date({ ...owned, required: true }),
    status: f.enum(['draft', 'confirmed', 'cancelled'], { ...owned, required: true, default: 'draft' }),
    sources: f.json<CompanySource[]>({ ...privateSource, required: true }),
    mapping: f.json<GroupMapping[]>({ ...privateSource, required: true }),
    adjustments: f.json<GroupAdjustment[]>({ ...privateSource, required: true }),
    result: f.json<GroupResult>({ ...privateSource, required: true }),
    reviewBasis: f.text({ ...privateSource, required: true, maxLength: 2000 }),
    confirmedAt: f.timestamp(owned),
    reason: f.text({ ...privateSource, maxLength: 1000 }),
  },
  permissions: { roles: { accounting: ['read', 'create', 'update'] } },
  views: { list: ['name', 'from', 'to', 'status'] },
});
