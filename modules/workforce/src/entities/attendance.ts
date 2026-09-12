import { defineEntity, f, label } from '@daifuku/kernel';
import { attendanceStatuses, requestStatuses } from '../contract.ts';
import { identityFields, owned, personPermissions, reviewFields, requestFields, edit } from './common.ts';
export const WorkforceAttendance = defineEntity({
  name: 'workforce_attendance', label: label('日次勤怠', 'Daily attendance'), ext: false, siteAccess: { kind: 'store', field: 'siteId' },
  fields: {
    ...identityFields(), workDate: f.date({ ...owned, required: true, immutable: true, label: label('勤務日', 'Work date') }),
    status: f.enum(attendanceStatuses, { ...owned, required: true, default: 'working', label: label('状態', 'Status') }),
    clockIn: f.timestamp({ ...owned, required: true, label: label('出勤', 'Clock in') }), clockOut: f.timestamp({ ...owned, label: label('退勤', 'Clock out') }),
    breakStartedAt: f.timestamp({ ...owned, label: label('休憩開始中', 'Current break start') }),
    breaks: f.json({ ...owned, required: true, default: [], label: label('休憩区間', 'Break intervals') }),
    workedMs: f.int({ ...owned, required: true, default: 0, min: 0, max: 86400000, hidden: true }),
    nightMs: f.int({ ...owned, required: true, default: 0, min: 0, max: 86400000, hidden: true }),
    dayKind: f.enum(['workday', 'statutory_holiday'], { ...owned, required: true, default: 'workday', label: label('休日区分（承認時確認）', 'Day classification') }),
    ...reviewFields(),
  },
  unique: [['employeeId', 'workDate']], indexes: [['siteId', 'workDate', 'status']],
  permissions: personPermissions({ employee: edit, manager: edit, hr: edit, payroll: edit }),
  views: { list: ['employeeId', 'workDate', 'clockIn', 'clockOut', 'status'], search: [] },
});
export const WorkforcePunch = defineEntity({
  name: 'workforce_punch', label: label('打刻履歴', 'Punch history'), ext: false, siteAccess: { kind: 'store', field: 'siteId' },
  fields: { ...identityFields(), ...requestFields(), attendanceId: f.ref('workforce_attendance', { ...owned, required: true, immutable: true }), kind: f.enum(['clock_in', 'break_start', 'break_end', 'clock_out'], { ...owned, required: true, immutable: true }), at: f.timestamp({ ...owned, required: true, immutable: true }) },
  permissions: personPermissions({ employee: ['read', 'create', 'export'], manager: ['read', 'create', 'export'], hr: ['read', 'create', 'export'], payroll: ['read', 'create', 'export'] }),
  views: { list: ['employeeId', 'attendanceId', 'kind', 'at'] },
});
export const WorkforceAttendanceCorrection = defineEntity({
  name: 'workforce_attendance_correction', label: label('勤怠訂正申請', 'Attendance corrections'), ext: false, siteAccess: { kind: 'store', field: 'siteId' },
  fields: {
    ...identityFields(), ...requestFields(), attendanceId: f.ref('workforce_attendance', { ...owned, required: true, immutable: true }), workDate: f.date({ ...owned, required: true, immutable: true }),
    sourceVersion: f.int({ ...owned, required: true, immutable: true, min: 1 }), status: f.enum(requestStatuses, { ...owned, required: true, default: 'pending' }),
    clockIn: f.timestamp({ ...owned, required: true, immutable: true }), clockOut: f.timestamp({ ...owned, required: true, immutable: true }), breaks: f.json({ ...owned, required: true, immutable: true }),
    reason: f.text({ ...owned, required: true, immutable: true, maxLength: 1000, label: label('訂正理由', 'Reason') }), ...reviewFields(),
  },
  indexes: [['attendanceId', 'status']], permissions: personPermissions({ employee: ['read', 'create', 'export'], manager: edit, hr: edit, payroll: edit }),
  views: { list: ['employeeId', 'workDate', 'reason', 'status'] },
});
