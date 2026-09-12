import { defineEntity, f, label } from '@daifuku/kernel';
import { E, H, M, P, edit, identityFields, owned, read } from './common.ts';
const people = { roles: { [E]: read, [P]: read, [M]: edit, [H]: edit }, rowRules: [{ roles: [E, P], where: { userId: '$ctx.userId' } }] };
export const WorkforceShiftProfile = defineEntity({
  name: 'workforce_shift_profile', label: label('社員のシフト条件', 'Employee shift conditions'), ext: false, siteAccess: { kind: 'parent', field: 'employeeId', entity: 'workforce_employee' },
  fields: { employeeId: f.ref('workforce_employee', { ...owned, required: true, immutable: true }), userId: f.uuid({ ...owned, required: true, immutable: true, hidden: true }), profile: f.json({ ...owned, required: true, label: label('勤務条件・スキル', 'Work conditions and skills') }) },
  unique: [['employeeId']], permissions: people, views: { list: ['employeeId', 'profile'] },
});
export const WorkforceShiftAvailability = defineEntity({
  name: 'workforce_shift_availability', label: label('週間勤務希望', 'Weekly availability'), ext: false, siteAccess: { kind: 'store', field: 'siteId' },
  fields: { ...identityFields(), weekStart: f.date({ ...owned, required: true, immutable: true }), days: f.json({ ...owned, required: true, label: label('7日間の勤務希望', 'Seven availability days') }) },
  unique: [['employeeId', 'weekStart']], permissions: { ...people, roles: { [E]: edit, [P]: edit, [M]: edit, [H]: edit } }, views: { list: ['employeeId', 'weekStart'] },
});
export const WorkforceShiftPlan = defineEntity({
  name: 'workforce_shift_plan', label: label('週間シフト計画', 'Weekly shift plans'), ext: false, siteAccess: { kind: 'store', field: 'siteId' },
  fields: {
    siteId: f.ref('workforce_site', { ...owned, required: true, immutable: true }), weekStart: f.date({ ...owned, required: true, immutable: true }),
    status: f.enum(['draft', 'published', 'superseded', 'cancelled'], { ...owned, required: true, default: 'draft' }), slots: f.json({ ...owned, required: true }), assignments: f.json({ ...owned, required: true }), sourceRevision: f.text({ ...owned, required: true, hidden: true }),
    seed: f.int({ ...owned, required: true, default: 1, min: 0 }), acknowledgeShortage: f.bool({ ...owned, required: true, default: false }), reason: f.text({ ...owned, maxLength: 1000 }), publishedAt: f.timestamp({ ...owned }),
  },
  indexes: [['siteId', 'weekStart', 'status']], permissions: { roles: { [M]: edit, [H]: edit } }, views: { list: ['siteId', 'weekStart', 'status', 'publishedAt'] },
});
export const WorkforceShiftAssignment = defineEntity({
  name: 'workforce_shift_assignment', label: label('公開勤務予定', 'Published shifts'), ext: false, siteAccess: { kind: 'store', field: 'siteId' },
  fields: {
    ...identityFields(), planId: f.ref('workforce_shift_plan', { ...owned, required: true, immutable: true }), slotId: f.text({ ...owned, required: true, immutable: true, maxLength: 80 }), date: f.date({ ...owned, required: true, immutable: true }), label: f.text({ ...owned, required: true, immutable: true, maxLength: 80 }), startMinute: f.int({ ...owned, required: true, immutable: true, min: 0, max: 1439 }), endMinute: f.int({ ...owned, required: true, immutable: true, min: 1, max: 1440 }), breakMinutes: f.int({ ...owned, required: true, immutable: true, min: 0, max: 1440 }), skill: f.text({ ...owned, required: true, immutable: true, maxLength: 40 }), active: f.bool({ ...owned, required: true, default: true }),
  },
  unique: [['planId', 'slotId', 'employeeId']], indexes: [['siteId', 'date', 'active'], ['employeeId', 'date', 'active']], permissions: { roles: { [E]: read, [P]: read, [M]: edit, [H]: edit }, rowRules: [{ roles: [E, P], where: { userId: '$ctx.userId', active: true } }] }, views: { list: ['employeeId', 'date', 'label', 'startMinute', 'endMinute', 'active'] },
});
