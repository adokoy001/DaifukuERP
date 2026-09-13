import { Decimal, isLocalDate, ValidationError, type LocalDate } from '@daifuku/kernel';
export function invalid(path: string, message: string): never {
  throw new ValidationError(message, [{ path, message }]);
}
export function amount(value: unknown, path: string): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value !== 'string' || !Decimal.isDecimalString(value))
    invalid(path, '有効な小数文字列を入力してください。');
  return Decimal.from(value);
}
export function requiredText(row: Record<string, unknown>, field: string): void {
  if (typeof row[field] !== 'string' || !String(row[field]).trim())
    invalid(field, `${field}: 証跡・内容を入力してください。`);
}
export function integerQuantity(row: Record<string, unknown>, field: string): void {
  const value = amount(row[field], field);
  if (!value.eq(value.roundDown(0))) invalid(field, `${field}: 整数で入力してください。`);
}
export function quarterHours(row: Record<string, unknown>, field: string): void {
  const value = amount(row[field], field).times(4);
  if (!value.eq(value.roundDown(0))) invalid(field, `${field}: 0.25時間（15分）単位で入力してください。`);
}
export function businessDate(value: unknown, field: string): LocalDate {
  if (typeof value !== 'string' || !isLocalDate(value))
    invalid(field, `${field}: YYYY-MM-DD形式の有効日を入力してください。`);
  return value;
}
export function addDays(date: LocalDate, days: number): LocalDate {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10) as LocalDate;
}
export function dayDifference(start: LocalDate, end: LocalDate): number {
  return (new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000;
}
