/** Production artifacts use a same-origin API prefix; explicit development/E2E URLs remain supported. */
export function apiBaseUrl(raw: unknown, production: boolean): string {
  if (typeof raw === 'string' && raw.length > 0) return raw.replace(/\/+$/, '');
  return production ? '/api' : 'http://localhost:3000';
}
