// Keep the fixture preparation and browser business dates aligned, including Tokyo midnight and year boundaries.
export const BUSINESS_DATE =
  process.env.E2E_INVOICE_DATE ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date());
if (
  !/^\d{4}-\d{2}-\d{2}$/.test(BUSINESS_DATE) ||
  new Date(`${BUSINESS_DATE}T00:00:00Z`).toISOString().slice(0, 10) !== BUSINESS_DATE
) {
  throw new Error('E2E_INVOICE_DATE must be a valid YYYY-MM-DD date');
}

export function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}
