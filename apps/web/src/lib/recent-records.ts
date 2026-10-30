// navigation-assist AC-3: records the user opened, newest first, at most 30 per user/tenant/company in this browser.
// Only the entity name, the id, a display name and the time are kept, never field values. Entities whose display name
// is personal data (employees and their payroll) keep no name at all. Pure; the React side is api/navigation-assist.ts.
import type { EntityMeta, Label, Locale, RecordJson } from '../api/types.ts';
import {
  assistKeysOf,
  envelope,
  parseEnvelope,
  readRaw,
  writeRaw,
  type AssistKeyedStorage,
  type AssistStorage,
} from './assist-storage.ts';
import { shortId } from './format.ts';
import { normalizeSearchText } from './navigation.ts';
import type { NavigationCatalog } from './navigation-types.ts';

export interface RecentRecord {
  entity: string;
  id: string;
  /** Display field or document number when the record was opened; absent for personal-data entities. */
  label?: string;
  /** Where the label came from. A display-field name is hidden once that field is masked for the user. */
  labelSource?: RecentLabelSource;
  openedAt: string;
}
export type RecentLabelSource = 'display' | 'number';
/** A recent record whose entity list is reachable in the current catalog, with that list's label. */
export interface RecentRecordView extends RecentRecord {
  entityLabel: Label;
}

export const MAX_RECENT_RECORDS = 30;
export const SIDEBAR_RECENT_RECORDS = 5;
const MAX_LABEL = 120;
const ENTITY = /^[a-z][a-z0-9_]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Employee records and payroll filing data: their display names identify people (spec open question 1). */
const PERSONAL_DATA = /^(?:workforce_|filing_payroll_)/;

export function isPersonalDataEntity(entity: string): boolean {
  return PERSONAL_DATA.test(entity);
}

function parseRecent(value: unknown): RecentRecord | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const { entity, id, label, labelSource, openedAt } = value as Record<string, unknown>;
  if (typeof entity !== 'string' || !ENTITY.test(entity) || typeof id !== 'string' || !UUID.test(id)) return undefined;
  if (typeof openedAt !== 'string' || openedAt.length > 40 || Number.isNaN(Date.parse(openedAt))) return undefined;
  // Applied on every read too, so a name written by an older build or by hand never reaches the screen.
  const name = typeof label === 'string' && !isPersonalDataEntity(entity) ? label.trim().slice(0, MAX_LABEL) : '';
  if (!name) return { entity, id, openedAt };
  // Anything but a known document-number source counts as a display-field name, the stricter case.
  return { entity, id, openedAt, label: name, labelSource: labelSource === 'number' ? 'number' : 'display' };
}

/** Lenient: invalid or duplicate items are dropped one by one, so one bad entry never hides the rest. */
export function parseRecentRecords(raw: string | null | undefined): RecentRecord[] {
  const seen = new Set<string>();
  const items: RecentRecord[] = [];
  for (const value of parseEnvelope(raw)) {
    const item = parseRecent(value);
    const key = item && `${item.entity}/${item.id}`;
    if (!item || !key || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length === MAX_RECENT_RECORDS) break;
  }
  return items;
}

/** The visit goes first; an earlier visit of the same record is replaced; the oldest beyond 30 fall off. */
export function addRecentRecord(items: readonly RecentRecord[], visit: RecentRecord): RecentRecord[] {
  const entry = parseRecent(visit);
  if (!entry) return [...items];
  return [entry, ...items.filter((item) => item.entity !== entry.entity || item.id !== entry.id)].slice(
    0,
    MAX_RECENT_RECORDS,
  );
}

/** Read-modify-write on the latest stored list (another tab may have added visits). False when storage is unusable. */
export function recordVisit(storage: AssistStorage | undefined, key: string | undefined, visit: RecentRecord): boolean {
  const raw = readRaw(storage, key);
  if (raw === undefined) return false;
  return writeRaw(storage, key, envelope(addRecentRecord(parseRecentRecords(raw), visit)));
}

/** The name worth remembering: the entity's display field, else the document number. Never for personal data. */
export function recentRecordLabel(
  entity: Pick<EntityMeta, 'name' | 'displayField'>,
  record: RecordJson,
): { label: string; labelSource: RecentLabelSource } | undefined {
  if (isPersonalDataEntity(entity.name)) return undefined;
  const display = entity.displayField ? record[entity.displayField] : undefined;
  if (typeof display === 'string' && display.trim())
    return { label: display.trim().slice(0, MAX_LABEL), labelSource: 'display' };
  return typeof record.number === 'string' && record.number
    ? { label: record.number.slice(0, MAX_LABEL), labelSource: 'number' }
    : undefined;
}

/**
 * Records of entities whose list is in the current catalog. Losing read permission on an entity hides its records;
 * a single record that became unreadable still shows and gets the normal permission error when opened. With the
 * current entity metadata, a display-field name is dropped when that field is no longer visible to the user (a
 * masked field group), so the record falls back to "<entity> <short id>".
 */
export function visibleRecentRecords(
  items: readonly RecentRecord[],
  catalog: NavigationCatalog,
  entities?: readonly Pick<EntityMeta, 'name' | 'displayField'>[],
): RecentRecordView[] {
  const lists = new Map(catalog.entries.filter((entry) => entry.kind === 'record').map((entry) => [entry.href, entry]));
  const displayFields = entities && new Map(entities.map((entity) => [entity.name, entity.displayField]));
  return items.flatMap((item) => {
    const list = lists.get(`/e/${item.entity}`);
    if (!list) return [];
    const masked = displayFields && item.labelSource !== 'number' && !displayFields.get(item.entity);
    if (!masked) return [{ ...item, entityLabel: list.label }];
    const { label: _label, labelSource: _source, ...rest } = item;
    return [{ ...rest, entityLabel: list.label }];
  });
}

/** What a recent record is called (link title, search): its stored name, else "<entity> <short id>". */
export function recentRecordText(item: RecentRecordView, locale: Locale): string {
  return item.label ?? `${item.entityLabel[locale] || item.entityLabel.en} ${shortId(item.id)}`;
}
/** The small second line under a recent record: the entity label, left out when the main text already has it. */
export function recentRecordDetail(item: RecentRecordView): Label | undefined {
  return item.label ? item.entityLabel : undefined;
}

/**
 * Explicit sign-out: the user's stored names are dropped in every company of this browser, so a shared computer
 * shows no record names after the user left. The records stay, listed as "<entity> <short id>". Never throws.
 */
export function forgetRecentLabels(storage: AssistKeyedStorage | undefined, tenantId: string, userId: string): number {
  let changed = 0;
  for (const key of assistKeysOf(storage, 'recent', tenantId, userId)) {
    const raw = readRaw(storage, key);
    const items = parseRecentRecords(raw);
    if (!items.some((item) => item.label)) continue;
    const unnamed = items.map(({ label: _label, labelSource: _source, ...rest }) => rest);
    if (writeRaw(storage, key, envelope(unnamed))) changed += 1;
  }
  return changed;
}

/** Same normalization and all-terms rule as the screen search; matches the name, the entity's labels and the id. */
export function searchRecentRecords(
  items: readonly RecentRecordView[],
  query: string,
  locale: Locale,
): RecentRecordView[] {
  const terms = normalizeSearchText(query, locale).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...items];
  return items.filter((item) => {
    const content = normalizeSearchText(
      [item.label ?? '', item.entityLabel.ja, item.entityLabel.en, item.entity, item.id].join(' '),
      locale,
    );
    return terms.every((term) => content.includes(term));
  });
}
