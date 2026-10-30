// Generic list preferences in browser storage (docs/specs/list-workbench.md AC-4/AC-5): the column layout and named
// saved views, per user, tenant, company and entity — the same boundary as the saved analyses (analytics-storage.ts):
// a key scoped by [tenantId, userId, companyId], a strict reader, and writes that pass the reader before they are stored.
// Storage is a per-viewer convenience: callers fall back to the defaults when it is missing, blocked or invalid.
// Pure apart from the storage/lock objects passed in; list-views.test.ts.
import type { EntityMeta, FieldMeta } from '../api/types.ts';
import type { AnalysisLockManager, AnalysisStorage } from './analytics-storage.ts';
import { extFieldsOf, listColumns } from './ext.ts';
import { MAX_FILTER_JSON, parseSort } from './query.ts';

export type ListStorage = AnalysisStorage;
export type ListLockManager = AnalysisLockManager;

export const MAX_SAVED_VIEWS = 30;
export const MAX_VIEW_COLUMNS = 100;
const MAX_STORED = 200_000;

export interface SavedListView {
  id: string;
  name: string;
  updatedAt: string;
  q?: string;
  sort?: string;
  /** Applied filters (the URL `f` value); checked against the entity again when the view is opened. */
  filters?: Record<string, unknown>;
  columns?: string[];
}

export interface ListPrefs {
  /** Visible columns in order; absent = the entity's `views.list`. */
  columns?: string[];
  views: SavedListView[];
}

export const EMPTY_PREFS: ListPrefs = { views: [] };

export class ListStorageError extends Error {
  constructor(readonly code: 'unsupported-version') {
    super(code);
    this.name = 'ListStorageError';
  }
}

export interface StorageScope {
  tenantId: string;
  userId: string;
  companyId: string;
}

export function listStorageKey(scope: StorageScope, entity: string): string {
  return `daifuku.list.v1.${JSON.stringify([scope.tenantId, scope.userId, scope.companyId, entity])}`;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown, max = 150): value is string {
  return typeof value === 'string' && value.length <= max;
}
function exact(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}
function columnList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_VIEW_COLUMNS &&
    value.every((c: unknown) => text(c, 120) && c.length > 0) &&
    new Set(value).size === value.length
  );
}

function parseView(item: unknown): SavedListView {
  if (
    !object(item) ||
    !exact(item, ['id', 'name', 'updatedAt', 'q', 'sort', 'filters', 'columns']) ||
    !text(item.id) ||
    !item.id ||
    !text(item.name, 80) ||
    !item.name.trim() ||
    !text(item.updatedAt)
  )
    throw new Error('Invalid saved list view.');
  const view: SavedListView = { id: item.id, name: item.name, updatedAt: item.updatedAt };
  if (item.q !== undefined) {
    if (!text(item.q, 200)) throw new Error('Invalid saved list view search.');
    view.q = item.q;
  }
  if (item.sort !== undefined) {
    if (!text(item.sort, 200) || !parseSort(item.sort)) throw new Error('Invalid saved list view sort.');
    view.sort = item.sort;
  }
  if (item.filters !== undefined) {
    if (!object(item.filters) || JSON.stringify(item.filters).length > MAX_FILTER_JSON)
      throw new Error('Invalid saved list view filters.');
    view.filters = item.filters;
  }
  if (item.columns !== undefined) {
    if (!columnList(item.columns)) throw new Error('Invalid saved list view columns.');
    view.columns = item.columns;
  }
  return view;
}

/** Strict reader: throws on anything it did not write itself (callers then use the defaults). */
export function readListPrefs(storage: ListStorage, key: string): ListPrefs {
  const raw = storage.getItem(key);
  if (!raw) return EMPTY_PREFS;
  if (raw.length > MAX_STORED) throw new Error('Saved list settings are too large.');
  const parsed: unknown = JSON.parse(raw);
  if (object(parsed) && typeof parsed.version === 'number' && parsed.version > 1)
    throw new ListStorageError('unsupported-version');
  if (
    !object(parsed) ||
    !exact(parsed, ['version', 'columns', 'views']) ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.views) ||
    parsed.views.length > MAX_SAVED_VIEWS
  )
    throw new Error('Unsupported saved list settings.');
  const views = parsed.views.map(parseView);
  if (new Set(views.map((v) => v.id)).size !== views.length) throw new Error('Duplicate saved list view.');
  if (parsed.columns !== undefined && !columnList(parsed.columns)) throw new Error('Invalid saved list columns.');
  return parsed.columns === undefined ? { views } : { columns: parsed.columns, views };
}

export function writeListPrefs(storage: ListStorage, key: string, prefs: ListPrefs): void {
  if (prefs.views.length > MAX_SAVED_VIEWS) throw new Error(`Up to ${MAX_SAVED_VIEWS} views can be saved.`);
  const raw = JSON.stringify({ version: 1, ...prefs });
  // Same strict boundary as reading: never persist extra properties or values the reader would refuse.
  readListPrefs({ getItem: () => raw, setItem: () => undefined }, key);
  storage.setItem(key, raw);
}

/**
 * Read-modify-write under the origin's Web Lock when the browser has one, so a view saved in another tab survives.
 * Without Web Locks the write still happens (these are per-viewer conveniences, unlike saved analyses). Unreadable
 * stored data of this version is replaced; data written by a newer version is never overwritten.
 */
export async function mutateListPrefs(
  storage: ListStorage,
  locks: ListLockManager | undefined,
  key: string,
  change: (prefs: ListPrefs) => ListPrefs,
): Promise<ListPrefs> {
  const apply = () => {
    let current: ListPrefs;
    try {
      current = readListPrefs(storage, key);
    } catch (error) {
      if (error instanceof ListStorageError) throw error;
      current = EMPTY_PREFS;
    }
    const next = change(current);
    writeListPrefs(storage, key, next);
    return next;
  };
  return locks ? locks.request(key, { mode: 'exclusive' }, apply) : apply();
}

// ---- columns (AC-4) -------------------------------------------------------------------------

/** Fields the column chooser offers: the entity's visible fields and ext fields, without JSON blobs. */
export function columnCandidates(entity: EntityMeta): FieldMeta[] {
  const own = entity.fields.filter(
    (f) =>
      !f.hidden &&
      f.kind !== 'json' &&
      !(entity.kind === 'document' && (f.name === 'number' || f.name === 'docstatus')),
  );
  return [...own, ...extFieldsOf(entity).filter((f) => f.kind !== 'json')];
}

/** Stored column names -> fields; unknown (or no longer readable) names are dropped; nothing left = the list view. */
export function resolveColumns(entity: EntityMeta, names: readonly string[] | undefined): FieldMeta[] {
  if (!names) return listColumns(entity);
  const candidates = columnCandidates(entity);
  const picked = names.flatMap((n) => candidates.filter((f) => f.name === n));
  return picked.length ? picked : listColumns(entity);
}

/** True when `names` is the entity's default column list (nothing to store). */
export function isDefaultColumns(entity: EntityMeta, names: readonly string[]): boolean {
  const defaults = listColumns(entity).map((f) => f.name);
  return defaults.length === names.length && defaults.every((n, i) => names[i] === n);
}

/** Moves the column at `index` by `delta` (-1 up, +1 down); out-of-range moves return the same order. */
export function moveColumn(names: readonly string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta;
  if (index < 0 || index >= names.length || target < 0 || target >= names.length) return [...names];
  const next = [...names];
  const [item] = next.splice(index, 1);
  if (item !== undefined) next.splice(target, 0, item);
  return next;
}

// ---- saved views (AC-5) ---------------------------------------------------------------------

export function newViewId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Adds (or replaces the same-named) view; the newest first. Throws when the limit would be exceeded. */
export function saveView(prefs: ListPrefs, view: SavedListView): ListPrefs {
  const others = prefs.views.filter((v) => v.id !== view.id && v.name.trim() !== view.name.trim());
  if (others.length >= MAX_SAVED_VIEWS) throw new Error(`Up to ${MAX_SAVED_VIEWS} views can be saved.`);
  return { ...prefs, views: [view, ...others] };
}

export function deleteView(prefs: ListPrefs, id: string): ListPrefs {
  return { ...prefs, views: prefs.views.filter((v) => v.id !== id) };
}
