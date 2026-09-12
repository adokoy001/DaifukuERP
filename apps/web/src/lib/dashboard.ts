// Home dashboard (web-polish): grouping of /meta for the cards and the count queries behind them. Pure; dashboard.test.ts.
import type { AppMeta, Docstatus, EntityMeta, Label } from '../api/types.ts';
import { buildListQuery } from './query.ts';

export const DOCSTATUSES: readonly Docstatus[] = [0, 1, 2];

/** `GET /api/<entity>?<countQuery(ds)>`: limit 1 because only `total` is read. */
export function countQuery(ds: Docstatus): string {
  return buildListQuery({ where: { docstatus: ds } }, 1).toString();
}

export interface ModuleGroup {
  name: string;
  label: Label;
  documents: EntityMeta[];
  masters: EntityMeta[];
}

/**
 * Entities by module in /meta order (a module with no readable entity is dropped); entities whose module is not listed
 * (or undefined) form a trailing group labelled `otherLabel`.
 */
export function groupByModule(meta: Pick<AppMeta, 'entities' | 'modules'>, otherLabel: Label): ModuleGroup[] {
  const groups: ModuleGroup[] = meta.modules.map((m) => ({ name: m.name, label: m.label, documents: [], masters: [] }));
  const other: ModuleGroup = { name: '', label: otherLabel, documents: [], masters: [] };
  const lines = new Set(meta.entities.flatMap((e) => (e.lines ?? []).map((line) => line.entity)));
  for (const e of meta.entities.filter((e) => !lines.has(e.name))) {
    const g = groups.find((x) => x.name === e.module) ?? other;
    (e.kind === 'document' ? g.documents : g.masters).push(e);
  }
  return [...groups, other].filter((g) => g.documents.length > 0 || g.masters.length > 0);
}
