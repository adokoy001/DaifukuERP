import { defineEntity, f, label } from '@daifuku/kernel';
import { E, H, M, P, owned, read } from './common.ts';

/** Companion only: changing the old rule row would change legacy annual fingerprints. */
export const WorkforcePayrollRuleRelease = defineEntity({
  name: 'workforce_payroll_rule_release',
  label: label('給与制度の承認版', 'Approved payroll rule releases'),
  ext: false,
  siteAccess: { kind: 'sharedRead' },
  fields: {
    packageCode: f.text({ ...owned, required: true, immutable: true, unique: true }),
    ruleId: f.ref('workforce_payroll_rules', { ...owned, required: true, immutable: true, unique: true }),
    taxYear: f.int({ ...owned, required: true, immutable: true }),
    country: f.text({ ...owned, required: true, immutable: true }),
    currency: f.text({ ...owned, required: true, immutable: true }),
    manifest: f.json({ ...owned, required: true, immutable: true }),
    payloadHash: f.text({ ...owned, required: true, immutable: true }),
    manifestHash: f.text({ ...owned, required: true, immutable: true }),
    status: f.enum(['approved'], { ...owned, required: true, immutable: true }),
    supersedesReleaseId: f.ref('workforce_payroll_rule_release', { ...owned, immutable: true }),
    approvedBy: f.uuid({ ...owned, required: true, immutable: true }),
    approvedAt: f.timestamp({ ...owned, required: true, immutable: true }),
    approvalBasis: f.text({ ...owned, required: true, immutable: true, maxLength: 2000 }),
  },
  permissions: { roles: { [E]: read, [M]: read, [H]: read, [P]: ['read', 'export', 'create'] } },
  views: { list: ['packageCode', 'taxYear', 'status', 'approvedAt'] },
});
