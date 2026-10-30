// navigation-assist AC-3/AC-4/AC-7: the browser-local lists (recent records, favourite screens) share one boundary,
// user + tenant + company like the saved analyses (analytics-storage.ts), and one failure rule: a storage that is
// missing, blocked, full or holds something unreadable only hides the lists. Pure; no React, no API, no business data.

export interface AssistScope {
  tenantId: string;
  userId: string;
  companyId: string;
}
export interface AssistStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export type AssistKind = 'recent' | 'favorites';

/** Upper bound on what is parsed; both lists are small (30 records, 20 screens), anything larger is not ours. */
const MAX_RAW = 64_000;

/** Undefined when any part of the boundary is unknown (signed out, no company): nothing is read or written then. */
export function assistStorageKey(kind: AssistKind, scope: AssistScope | undefined): string | undefined {
  if (!scope?.tenantId || !scope.userId || !scope.companyId) return undefined;
  return `daifuku.${kind}.v1.${JSON.stringify([scope.tenantId, scope.userId, scope.companyId])}`;
}

/** Reading `localStorage` itself throws when site data is blocked; that is "no storage", not an error. */
export function browserStorage(): AssistStorage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

/** The stored text, `null` when nothing is stored yet, or `undefined` when the storage cannot be used at all. */
export function readRaw(storage: AssistStorage | undefined, key: string | undefined): string | null | undefined {
  if (!storage || !key) return undefined;
  try {
    return storage.getItem(key);
  } catch {
    return undefined;
  }
}

/** False instead of an exception when the browser refuses the write (quota exceeded, private mode). */
export function writeRaw(storage: AssistStorage | undefined, key: string | undefined, value: string): boolean {
  if (!storage || !key) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Items of a `{ version: 1, items: [...] }` envelope; anything else (old format, corrupt JSON) reads as empty. */
export function parseEnvelope(raw: string | null | undefined): unknown[] {
  if (!raw || raw.length > MAX_RAW) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
    const { version, items } = parsed as { version?: unknown; items?: unknown };
    return version === 1 && Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

export function envelope(items: readonly unknown[]): string {
  return JSON.stringify({ version: 1, items });
}
