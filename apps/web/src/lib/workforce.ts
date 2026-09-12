import type { Label, Locale } from '../api/types.ts';

export const workforceStatuses: Record<string, Label> = {
  working: { ja: '勤務中', en: 'Working' }, break: { ja: '休憩中', en: 'On break' }, closed: { ja: '退勤済み', en: 'Clocked out' },
  submitted: { ja: '確認待ち', en: 'Submitted' }, approved: { ja: '承認済み', en: 'Approved' }, returned: { ja: '差戻し', en: 'Returned' },
  pending: { ja: '承認待ち', en: 'Pending' }, rejected: { ja: '却下', en: 'Rejected' }, cancelled: { ja: '取消済み', en: 'Cancelled' },
  draft: { ja: '下書き', en: 'Draft' }, settled: { ja: '精算済み', en: 'Settled' }, confirmed: { ja: '確定済み', en: 'Confirmed' },
};
export function workforceTone(status: string): 'positive' | 'pending' | 'negative' | undefined {
  if (['working', 'approved', 'settled', 'confirmed'].includes(status)) return 'positive';
  if (['break', 'pending', 'submitted'].includes(status)) return 'pending';
  if (['rejected', 'returned', 'cancelled'].includes(status)) return 'negative';
  return undefined;
}
export function minutesLabel(minutes: number, locale: Locale): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  const whole = Math.floor(minutes);
  return locale === 'ja' ? `${Math.floor(whole / 60)}時間 ${whole % 60}分` : `${Math.floor(whole / 60)}h ${whole % 60}m`;
}
export function timeLabel(timestamp: string | null | undefined): string {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false });
}
export function dateTimeInput(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19);
}
export const leavePortions: Record<string, Label> = { full: { ja: '1日', en: 'Full day' }, morning: { ja: '午前半日', en: 'Morning' }, afternoon: { ja: '午後半日', en: 'Afternoon' } };
export const deductionLabels = {
  income_tax: { ja: '所得税', en: 'Income tax' }, resident_tax: { ja: '住民税', en: 'Resident tax' },
  health_insurance: { ja: '健康保険', en: 'Health insurance' }, nursing_insurance: { ja: '介護保険', en: 'Nursing care insurance' },
  pension: { ja: '厚生年金', en: 'Employees pension' }, employment_insurance: { ja: '雇用保険', en: 'Employment insurance' },
  child_support: { ja: '子ども・子育て支援金', en: 'Child support contribution' }, other: { ja: 'その他控除', en: 'Other deductions' },
} satisfies Record<string, Label>;
