/** The value, or a test failure naming what was missing (instead of a non-null assertion). */
export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}
