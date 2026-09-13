import { f, label, type Op, type PermissionConfig } from '@daifuku/kernel';
export const E = 'workforce_employee';
export const M = 'workforce_manager';
export const H = 'workforce_hr';
export const P = 'workforce_payroll';
export const owned = { serverOwned: true } as const;
export const read = ['read', 'export'] as const;
export const edit = ['read', 'create', 'update', 'export'] as const;
export function identityFields() {
  return {
    employeeId: f.ref('workforce_employee', {
      ...owned,
      required: true,
      immutable: true,
      label: label('従業員', 'Employee'),
    }),
    userId: f.uuid({ ...owned, required: true, immutable: true, label: label('利用者ID', 'User ID'), hidden: true }),
    siteId: f.ref('workforce_site', { ...owned, required: true, immutable: true, label: label('所属拠点', 'Site') }),
  };
}
export function personPermissions(
  roles: { employee?: readonly Op[]; manager?: readonly Op[]; hr?: readonly Op[]; payroll?: readonly Op[] },
  confirmedOnly = false,
): PermissionConfig {
  return {
    roles: Object.fromEntries(
      [
        [E, roles.employee],
        [M, roles.manager],
        [H, roles.hr],
        [P, roles.payroll],
      ].filter((entry): entry is [string, readonly Op[]] => entry[1] !== undefined),
    ),
    rowRules: [
      {
        roles: confirmedOnly ? [E, M, H] : [E],
        where: { userId: '$ctx.userId', ...(confirmedOnly ? { docstatus: 1 } : {}) },
      },
    ],
  };
}
export function reviewFields() {
  return {
    reviewedBy: f.uuid({ ...owned, label: label('確認者', 'Reviewer') }),
    reviewedAt: f.timestamp({ ...owned, label: label('確認日時', 'Reviewed at') }),
    reviewReason: f.text({ ...owned, maxLength: 1000, label: label('確認・差戻し理由', 'Review reason') }),
  };
}
export function requestFields() {
  return {
    idempotencyKey: f.uuid({ ...owned, required: true, immutable: true, unique: true, hidden: true }),
    requestSnapshot: f.json({ ...owned, required: true, immutable: true, hidden: true }),
  };
}
