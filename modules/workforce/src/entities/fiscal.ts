import { defineDocument, defineEntity, f, label } from '@daifuku/kernel';
import { E, H, M, P, edit, identityFields, owned, personPermissions, read, reviewFields } from './common.ts';
export const WorkforcePayrollRules = defineEntity({
  name: 'workforce_payroll_rules', label: label('国内給与の制度資料', 'Japanese payroll rule sources'), ext: false, siteAccess: { kind: 'sharedRead' },
  fields: { code: f.text({ ...owned, required: true, immutable: true, unique: true }), taxYear: f.int({ ...owned, required: true, immutable: true }), data: f.json({ ...owned, required: true, immutable: true }), sources: f.json({ ...owned, required: true, immutable: true }), verifiedOn: f.date({ ...owned, required: true, immutable: true }) },
  permissions: { roles: { [E]: read, [M]: read, [H]: read, [P]: edit } }, views: { list: ['code', 'taxYear', 'verifiedOn'] },
});
export const WorkforcePayrollCondition = defineEntity({
  name: 'workforce_payroll_condition', label: label('税・保険の本人条件', 'Effective employee tax and insurance facts'), ext: false,
  fields: { employeeId: f.ref('workforce_employee', { ...owned, required: true, immutable: true }), validFrom: f.date({ ...owned, required: true }), validTo: f.date({ ...owned, required: true }), condition: f.json({ ...owned, required: true }) },
  indexes: [['employeeId', 'validFrom', 'validTo']], permissions: { roles: { [P]: edit } }, views: { list: ['employeeId', 'validFrom', 'validTo'] },
});
export const WorkforcePayrollTaxEvidence = defineEntity({
  name: 'workforce_payroll_tax_evidence', label: label('確定給与の支払・課税証跡', 'Published payroll tax evidence'), ext: false,
  fields: { ...identityFields(), payrollId: f.ref('workforce_payroll', { ...owned, required: true, immutable: true }), paymentDate: f.date({ ...owned, required: true, immutable: true }), taxablePay: f.money({ ...owned, required: true, immutable: true, min: '0' }), socialPremium: f.money({ ...owned, required: true, immutable: true, min: '0' }), incomeTax: f.money({ ...owned, required: true, immutable: true, min: '0' }), basis: f.text({ ...owned, required: true, immutable: true, maxLength: 2000 }) },
  unique: [['payrollId']], indexes: [['employeeId', 'paymentDate']], permissions: { roles: { [P]: edit } }, views: { list: ['payrollId', 'paymentDate', 'taxablePay', 'incomeTax'] },
});
export const WorkforceYearEndDeclaration = defineEntity({
  name: 'workforce_year_end_declaration', label: label('年末調整の本人申告', 'Employee year-end tax declaration'), ext: false, siteAccess: { kind: 'parent', field: 'employeeId', entity: 'workforce_employee' },
  fields: { ...identityFields(), taxYear: f.int({ ...owned, required: true, immutable: true }), declaration: f.json({ ...owned, required: true }), status: f.enum(['submitted', 'accepted', 'returned'], { ...owned, required: true, default: 'submitted' }), ...reviewFields() },
  unique: [['employeeId', 'taxYear']], permissions: { roles: { [E]: edit, [M]: edit, [H]: edit, [P]: edit }, rowRules: [{ roles: [E, M, H], where: { userId: '$ctx.userId' } }] }, views: { list: ['employeeId', 'taxYear', 'status'] },
});
export const WorkforceYearEndAdjustment = defineDocument({
  name: 'workforce_year_end_adjustment', label: label('年末調整計算・精算', 'Year-end tax calculation and settlement'), ext: false, siteAccess: { kind: 'parent', field: 'employeeId', entity: 'workforce_employee' }, naming: { type: 'sequence', prefix: 'YEA-', period: 'year' },
  fields: { ...identityFields(), taxYear: f.int({ ...owned, required: true, immutable: true }), declarationId: f.ref('workforce_year_end_declaration', { ...owned, required: true }), adjustedOn: f.date({ ...owned, required: true }), taxablePay: f.money({ ...owned, required: true, min: '0' }), annualTax: f.money({ ...owned, required: true, min: '0' }), withheldTax: f.money({ ...owned, required: true, min: '0' }), refund: f.money({ ...owned, required: true, min: '0' }), additionalTax: f.money({ ...owned, required: true, min: '0' }), calculation: f.json({ ...owned, required: true }), sourceFingerprint: f.text({ ...owned, required: true, hidden: true }), settledOn: f.date({ ...owned }), settlementReference: f.text({ ...owned, maxLength: 2000 }), ...reviewFields() },
  allowOnSubmit: ['reviewedBy', 'reviewedAt', 'reviewReason', 'settledOn', 'settlementReference'], indexes: [['employeeId', 'taxYear']], permissions: personPermissions({ employee: read, manager: read, hr: read, payroll: ['read', 'create', 'update', 'submit', 'cancel', 'export'] }, true), views: { list: ['employeeId', 'taxYear', 'annualTax', 'refund', 'additionalTax', 'settledOn'] },
});
