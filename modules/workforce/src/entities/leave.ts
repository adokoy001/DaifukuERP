import { defineEntity, f, label } from '@daifuku/kernel';
import { requestStatuses } from '../contract.ts';
import { identityFields, owned, personPermissions, reviewFields, requestFields, read } from './common.ts';
export const WorkforceLeaveGrant = defineEntity({
  name: 'workforce_leave_grant', label: label('有給休暇付与', 'Paid leave grants'), ext: false, siteAccess: { kind: 'store', field: 'siteId' },
  fields: { ...identityFields(), validFrom: f.date({ ...owned, required: true, immutable: true }), expiresOn: f.date({ ...owned, required: true, immutable: true }), days: f.decimal({ ...owned, required: true, immutable: true, scale: 1, min: '0.5' }), eligibilityConfirmed: f.bool({ ...owned, required: true, immutable: true }), basis: f.text({ ...owned, required: true, immutable: true, maxLength: 1000 }), grantedBy: f.uuid({ ...owned, required: true, immutable: true }) },
  indexes: [['employeeId', 'validFrom', 'expiresOn']], permissions: personPermissions({ employee: read, manager: read, hr: ['read', 'create', 'export'], payroll: read }),
  views: { list: ['employeeId', 'validFrom', 'expiresOn', 'days', 'basis'] },
});
export const WorkforceLeaveRequest = defineEntity({
  name: 'workforce_leave_request', label: label('有給休暇申請', 'Paid leave requests'), ext: false, siteAccess: { kind: 'store', field: 'siteId' },
  fields: { ...identityFields(), ...requestFields(), leaveDate: f.date({ ...owned, required: true, immutable: true }), portion: f.enum(['full', 'morning', 'afternoon'], { ...owned, required: true, immutable: true }), days: f.decimal({ ...owned, required: true, immutable: true, scale: 1, min: '0.5' }), status: f.enum(requestStatuses, { ...owned, required: true, default: 'pending' }), reason: f.text({ ...owned, required: true, immutable: true, maxLength: 1000 }), ...reviewFields() },
  indexes: [['employeeId', 'leaveDate', 'status']], permissions: personPermissions({ employee: ['read', 'create', 'update', 'export'], manager: ['read', 'create', 'update', 'export'], hr: ['read', 'create', 'update', 'export'], payroll: ['read', 'create', 'update', 'export'] }),
  views: { list: ['employeeId', 'leaveDate', 'portion', 'days', 'status'] },
});
export const WorkforceLeaveUsage = defineEntity({
  name: 'workforce_leave_usage', label: label('有給消費・返還履歴', 'Paid leave ledger'), ext: false, siteAccess: { kind: 'store', field: 'siteId' },
  fields: { ...identityFields(), requestId: f.ref('workforce_leave_request', { ...owned, required: true, immutable: true }), grantId: f.ref('workforce_leave_grant', { ...owned, required: true, immutable: true }), days: f.decimal({ ...owned, required: true, immutable: true, scale: 1 }), kind: f.enum(['consume', 'release'], { ...owned, required: true, immutable: true }), at: f.timestamp({ ...owned, required: true, immutable: true }) },
  unique: [['requestId', 'grantId', 'kind']], permissions: personPermissions({ employee: ['read', 'create', 'export'], manager: ['read', 'create', 'export'], hr: ['read', 'create', 'export'], payroll: ['read', 'create', 'export'] }),
  views: { list: ['employeeId', 'requestId', 'grantId', 'kind', 'days'] },
});
