import { describe, expect, it } from 'vitest';
import type { EntityMeta } from '../api/types.ts';
import { countQuery, DOCSTATUSES, groupByModule } from './dashboard.ts';

function entity(name: string, kind: 'entity' | 'document', module: string | undefined): EntityMeta {
  return {
    name,
    kind,
    label: { ja: name, en: name },
    module,
    scope: 'company',
    displayField: undefined,
    hasExt: false,
    fields: [],
    views: { list: [], form: 'auto', search: [] },
    ops: ['read'],
  };
}

const OTHER = { ja: 'その他', en: 'Other' };

describe('countQuery (home dashboard: one cheap list call per entity per docstatus)', () => {
  it('asks for one row filtered by docstatus (only `total` is used)', () => {
    expect(DOCSTATUSES).toEqual([0, 1, 2]);
    const p = new URLSearchParams(countQuery(1));
    expect(p.get('limit')).toBe('1');
    expect(p.get('offset')).toBe('0');
    expect(JSON.parse(p.get('where') ?? '{}')).toEqual({ docstatus: 1 });
    expect(p.has('search')).toBe(false);
  });
});

describe('groupByModule', () => {
  it('keeps module order, splits documents from masters, drops empty modules and collects unknown modules last', () => {
    const meta = {
      modules: [
        { name: 'sales', label: { ja: '販売', en: 'Sales' }, menus: [] },
        { name: 'empty', label: { ja: '空', en: 'Empty' }, menus: [] },
        { name: 'partner', label: { ja: '取引先', en: 'Partners' }, menus: [] },
      ],
      entities: [
        entity('partner', 'entity', 'partner'),
        entity('sales_invoice', 'document', 'sales'),
        entity('sales_invoice_line', 'entity', 'sales'),
        entity('attachment', 'entity', undefined),
        entity('stray_doc', 'document', 'nope'),
      ],
    };
    const groups = groupByModule(meta, OTHER);
    expect(groups.map((g) => g.name)).toEqual(['sales', 'partner', '']);
    expect(groups[0]?.documents.map((e) => e.name)).toEqual(['sales_invoice']);
    expect(groups[0]?.masters.map((e) => e.name)).toEqual(['sales_invoice_line']);
    expect(groups[1]?.documents).toEqual([]);
    expect(groups[2]?.label).toEqual(OTHER);
    expect(groups[2]?.documents.map((e) => e.name)).toEqual(['stray_doc']);
    expect(groups[2]?.masters.map((e) => e.name)).toEqual(['attachment']);
  });
  it('is empty for an empty /meta', () => {
    expect(groupByModule({ modules: [], entities: [] }, OTHER)).toEqual([]);
  });
});
