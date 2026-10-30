// navigation-assist (docs/specs/navigation-assist.md): storage boundaries, limits, failure handling and the
// palette candidates. The storage is an in-memory double; failures are simulated by throwing accessors.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AppMeta, EntityMeta, Label, RecordJson } from '../api/types.ts';
import {
  assistStorageKey,
  browserStorage,
  envelope,
  parseEnvelope,
  readRaw,
  writeRaw,
  type AssistStorage,
} from './assist-storage.ts';
import { buildPalette, movePaletteSelection, PALETTE_SCREEN_LIMIT } from './command-palette.ts';
import {
  isFavoriteHref,
  MAX_FAVORITES,
  parseFavorites,
  toggleFavorite,
  toggleStoredFavorite,
  visibleFavorites,
} from './favorites.ts';
import { buildNavigation } from './navigation.ts';
import {
  addRecentRecord,
  isPersonalDataEntity,
  MAX_RECENT_RECORDS,
  parseRecentRecords,
  recentRecordLabel,
  recentRecordText,
  recordVisit,
  searchRecentRecords,
  visibleRecentRecords,
  type RecentRecord,
} from './recent-records.ts';

const label = (ja: string, en = ja): Label => ({ ja, en });
function entity(name: string, extra: Partial<EntityMeta> = {}): EntityMeta {
  return {
    name,
    module: name.startsWith('workforce_') ? 'workforce' : 'sales',
    kind: 'entity',
    label: label(name === 'partner' ? '取引先' : name, name === 'partner' ? 'Partners' : name),
    scope: 'company',
    displayField: 'name',
    hasExt: false,
    fields: [],
    views: { list: [], form: 'auto', search: [] },
    ops: ['read'],
    ...extra,
  };
}
const meta = (entities: EntityMeta[]): AppMeta => ({ entities, actions: [], modules: [], roles: ['viewer'] });
const catalog = buildNavigation(
  meta([entity('partner'), entity('sales_invoice'), entity('workforce_employee')]),
  false,
);

function memory(): AssistStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
const throwing = (what: 'read' | 'write'): AssistStorage => ({
  getItem: () => {
    if (what === 'read') throw new DOMException('blocked', 'SecurityError');
    return null;
  },
  setItem: () => {
    throw new DOMException('full', 'QuotaExceededError');
  },
});
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const visit = (n: number, entityName = 'partner', name?: string): RecentRecord => ({
  entity: entityName,
  id: uuid(n),
  openedAt: new Date(Date.UTC(2026, 9, 29, 0, 0, n)).toISOString(),
  ...(name ? { label: name } : {}),
});
const scope = { tenantId: 'tenant-a', userId: 'user-a', companyId: 'company-a' };

describe('navigation-assist AC-3: recent records per user, tenant and company', () => {
  it('AC-3: keys differ per user, tenant and company, and nothing is keyed without a company', () => {
    const keys = new Set([
      assistStorageKey('recent', scope),
      assistStorageKey('recent', { ...scope, companyId: 'company-b' }),
      assistStorageKey('recent', { ...scope, userId: 'user-b' }),
      assistStorageKey('recent', { ...scope, tenantId: 'tenant-b' }),
      assistStorageKey('favorites', scope),
    ]);
    expect(keys.size).toBe(5);
    expect(assistStorageKey('recent', { ...scope, companyId: '' })).toBeUndefined();
    expect(assistStorageKey('recent', undefined)).toBeUndefined();
    // Separators inside ids cannot make two scopes collide (JSON array, as for saved analyses).
    expect(assistStorageKey('recent', { tenantId: 'a.b', userId: 'c', companyId: 'd' })).not.toBe(
      assistStorageKey('recent', { tenantId: 'a', userId: 'b.c', companyId: 'd' }),
    );
  });

  it('AC-3: a visit under one company is not listed after switching to another company', () => {
    const storage = memory();
    const companyA = assistStorageKey('recent', scope);
    const companyB = assistStorageKey('recent', { ...scope, companyId: 'company-b' });
    expect(recordVisit(storage, companyA, visit(1, 'partner', '株式会社みどり'))).toBe(true);
    expect(parseRecentRecords(readRaw(storage, companyB))).toEqual([]);
    expect(parseRecentRecords(readRaw(storage, companyA)).map((item) => item.label)).toEqual(['株式会社みどり']);
  });

  it('AC-3: keeps the newest 30, newest first, and moves a revisited record to the top', () => {
    let items: RecentRecord[] = [];
    for (let n = 1; n <= MAX_RECENT_RECORDS + 5; n++) items = addRecentRecord(items, visit(n));
    expect(items).toHaveLength(MAX_RECENT_RECORDS);
    expect(items[0]?.id).toBe(uuid(35));
    expect(items.at(-1)?.id).toBe(uuid(6));
    items = addRecentRecord(items, { ...visit(20), openedAt: '2026-10-29T01:00:00.000Z' });
    expect(items).toHaveLength(MAX_RECENT_RECORDS);
    expect(items[0]).toMatchObject({ id: uuid(20), openedAt: '2026-10-29T01:00:00.000Z' });
    expect(items.filter((item) => item.id === uuid(20))).toHaveLength(1);
    // A stored list longer than the limit (another build, edited by hand) is cut on read.
    const long = envelope(Array.from({ length: 40 }, (_, n) => visit(n + 1)));
    expect(parseRecentRecords(long)).toHaveLength(MAX_RECENT_RECORDS);
  });

  it('AC-3: stores no display name for personal-data entities, also when one was written by hand', () => {
    expect(isPersonalDataEntity('workforce_employee')).toBe(true);
    expect(isPersonalDataEntity('workforce_payroll')).toBe(true);
    expect(isPersonalDataEntity('filing_payroll_profile')).toBe(true);
    expect(isPersonalDataEntity('partner')).toBe(false);
    const employee = entity('workforce_employee');
    const row = { id: uuid(1), version: 1, name: '山田 花子', number: 'E-1' } as unknown as RecordJson;
    expect(recentRecordLabel(employee, row)).toBeUndefined();
    expect(addRecentRecord([], visit(1, 'workforce_employee', '山田 花子'))[0]).not.toHaveProperty('label');
    const storage = memory();
    const key = assistStorageKey('recent', scope);
    expect(recordVisit(storage, key, visit(1, 'workforce_employee', '山田 花子'))).toBe(true);
    expect(storage.values.get(key ?? '')).not.toContain('山田');
    const tampered = envelope([{ ...visit(2, 'workforce_employee'), label: '鈴木 一郎' }]);
    expect(parseRecentRecords(tampered)[0]).not.toHaveProperty('label');
    const [view] = visibleRecentRecords(parseRecentRecords(tampered), catalog);
    expect(view && recentRecordText(view, 'ja')).toBe('workforce_employee 00000000…');
  });

  it('AC-3: the label is the display field, else the document number; field values are not stored', () => {
    const partner = entity('partner');
    const row = { id: uuid(1), version: 1, name: '  株式会社みどり ', phone: '03-0000-0000' } as unknown as RecordJson;
    expect(recentRecordLabel(partner, row)).toBe('株式会社みどり');
    const invoice = entity('sales_invoice', { displayField: undefined });
    expect(recentRecordLabel(invoice, { id: uuid(2), number: 'INV-2026-000001' } as unknown as RecordJson)).toBe(
      'INV-2026-000001',
    );
    expect(recentRecordLabel(invoice, { id: uuid(3) } as unknown as RecordJson)).toBeUndefined();
    const storage = memory();
    const key = assistStorageKey('recent', scope);
    recordVisit(storage, key, { ...visit(1), label: recentRecordLabel(partner, row) ?? '' });
    expect(storage.values.get(key ?? '')).not.toContain('03-0000-0000');
  });

  it('AC-3: only records of entities in the current catalog are listed; invalid items are dropped one by one', () => {
    const raw = envelope([
      visit(1, 'partner', 'A'),
      visit(2, 'purchase_invoice', 'no permission'),
      { entity: 'partner', id: 'not-a-uuid', openedAt: '2026-10-29T00:00:00Z' },
      { entity: '../x', id: uuid(3), openedAt: '2026-10-29T00:00:00Z' },
      { ...visit(4), openedAt: 'yesterday' },
      visit(1, 'partner', 'duplicate'),
      visit(5, 'sales_invoice'),
    ]);
    const items = visibleRecentRecords(parseRecentRecords(raw), catalog);
    expect(items.map((item) => [item.entity, item.label])).toEqual([
      ['partner', 'A'],
      ['sales_invoice', undefined],
    ]);
    expect(items[0]?.entityLabel).toEqual(label('取引先', 'Partners'));
  });

  it('AC-2: recent records match by name, entity label in either language, or id, with the screen-search rules', () => {
    const items = visibleRecentRecords(
      [visit(1, 'partner', 'カブシキガイシャ ミドリ'), visit(2, 'sales_invoice', 'INV-2026-000007')],
      catalog,
    );
    expect(searchRecentRecords(items, 'みどり', 'ja').map((item) => item.id)).toEqual([uuid(1)]);
    expect(searchRecentRecords(items, 'PARTNERS', 'en').map((item) => item.id)).toEqual([uuid(1)]);
    expect(searchRecentRecords(items, 'ｉｎｖ 000007', 'ja').map((item) => item.id)).toEqual([uuid(2)]);
    expect(searchRecentRecords(items, uuid(2).slice(-6), 'ja').map((item) => item.id)).toEqual([uuid(2)]);
    expect(searchRecentRecords(items, 'みどり 存在しない', 'ja')).toEqual([]);
  });
});

describe('navigation-assist AC-7: storage failures only hide the lists', () => {
  it('AC-7: a storage that throws on read reads as unavailable; a visit is not recorded and does not throw', () => {
    const key = assistStorageKey('recent', scope);
    expect(readRaw(throwing('read'), key)).toBeUndefined();
    expect(readRaw(undefined, key)).toBeUndefined();
    expect(readRaw(memory(), undefined)).toBeUndefined();
    expect(readRaw(memory(), key)).toBeNull();
    expect(() => recordVisit(throwing('read'), key, visit(1))).not.toThrow();
    expect(recordVisit(throwing('read'), key, visit(1))).toBe(false);
  });

  it('AC-7: a full storage refuses the write without an exception', () => {
    const key = assistStorageKey('favorites', scope);
    expect(writeRaw(throwing('write'), key, '[]')).toBe(false);
    expect(recordVisit(throwing('write'), key, visit(1))).toBe(false);
    expect(toggleStoredFavorite(throwing('write'), key, '/e/partner', catalog)).toBe('failed');
    expect(toggleStoredFavorite(throwing('read'), key, '/e/partner', catalog)).toBe('failed');
  });

  it('AC-7: corrupt, oversized or foreign data reads as an empty list', () => {
    for (const raw of ['{', 'null', '[]', '{"version":2,"items":[]}', '{"items":"x","version":1}', 'x'.repeat(70_000)])
      expect(parseEnvelope(raw)).toEqual([]);
    expect(parseRecentRecords('{')).toEqual([]);
    expect(parseFavorites('{"version":1,"items":{}}')).toEqual([]);
  });

  it('AC-7: a localStorage getter that throws (blocked site data) means no storage', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    try {
      expect(browserStorage()).toBeUndefined();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});

describe('navigation-assist AC-4: favourite screens', () => {
  it('AC-4: adds and removes a screen against the latest stored list, per company', () => {
    const storage = memory();
    const key = assistStorageKey('favorites', scope);
    const other = assistStorageKey('favorites', { ...scope, companyId: 'company-b' });
    expect(toggleStoredFavorite(storage, key, '/e/partner', catalog)).toBe('added');
    expect(toggleStoredFavorite(storage, key, '/analytics', catalog)).toBe('added');
    expect(parseFavorites(readRaw(storage, key))).toEqual(['/e/partner', '/analytics']);
    expect(parseFavorites(readRaw(storage, other))).toEqual([]);
    expect(toggleStoredFavorite(storage, key, '/e/partner', catalog)).toBe('removed');
    expect(parseFavorites(readRaw(storage, key))).toEqual(['/analytics']);
  });

  it('AC-4: shows only hrefs present in the current catalog, in the order they were added', () => {
    const stored = ['/analytics', '/e/purchase_invoice', '/e/partner', '/admin/users'];
    expect(visibleFavorites(stored, catalog).map((entry) => entry.href)).toEqual(['/analytics', '/e/partner']);
  });

  it('AC-4: rejects anything that is not a plain application path', () => {
    for (const href of ['/e/partner', '/r/accounting.trial_balance', '/workspaces/sales', '/'])
      expect(isFavoriteHref(href)).toBe(true);
    for (const href of [
      'https://example.com/',
      '//example.com',
      '/e/partner?x=1',
      '/e/partner#x',
      '/e/../admin',
      '/e/%2e%2e',
      '/e/partner/',
      'javascript:alert(1)',
      `/${'a'.repeat(250)}`,
      42,
    ])
      expect(isFavoriteHref(href)).toBe(false);
    expect(parseFavorites(envelope(['/e/partner', 'https://example.com/', '/e/partner', '/analytics']))).toEqual([
      '/e/partner',
      '/analytics',
    ]);
  });

  it('AC-4: at 20 favourites, hidden ones make room first; twenty visible screens refuse a new one', () => {
    const visible = Array.from({ length: MAX_FAVORITES }, (_, n) => `/screen-${n}`);
    const available = new Set([...visible, '/new']);
    expect(toggleFavorite(visible, '/new', available)).toEqual({ change: 'full', hrefs: visible });
    const withHidden = ['/lost', ...visible.slice(1)];
    const result = toggleFavorite(withHidden, '/new', available);
    expect(result.change).toBe('added');
    expect(result.hrefs).toHaveLength(MAX_FAVORITES);
    expect(result.hrefs).not.toContain('/lost');
    expect(result.hrefs.at(-1)).toBe('/new');
    expect(toggleFavorite([], 'https://example.com', available).change).toBe('invalid');
  });
});

describe('navigation-assist AC-2: palette candidates', () => {
  const big = buildNavigation(
    meta([entity('partner'), entity('sales_invoice'), ...Array.from({ length: 30 }, (_, n) => entity(`ledger_${n}`))]),
    false,
  );
  const records = visibleRecentRecords([visit(1, 'partner', '株式会社みどり'), visit(2, 'sales_invoice')], big);

  it('AC-2: with a query, authorized screens from searchNavigation come first, then matching recent records', () => {
    const palette = buildPalette({ catalog: big, query: '取引先', locale: 'ja', favorites: [], records });
    expect(palette.groups.map((group) => group.id)).toEqual(['screens', 'records']);
    expect(palette.options[0]).toMatchObject({ kind: 'screen', entry: { href: '/e/partner' } });
    expect(palette.options.at(-1)).toMatchObject({ kind: 'record', record: { label: '株式会社みどり' } });
    const none = buildPalette({ catalog: big, query: '存在しない画面', locale: 'ja', favorites: [], records });
    expect(none.options).toEqual([]);
  });

  it('AC-2: caps screens at 20 and reports the rest for the full screen search', () => {
    const palette = buildPalette({ catalog: big, query: 'ledger', locale: 'en', favorites: [], records });
    expect(palette.options.filter((option) => option.kind === 'screen')).toHaveLength(PALETTE_SCREEN_LIMIT);
    expect(palette.moreScreens).toBe(30 - PALETTE_SCREEN_LIMIT);
  });

  it('AC-2/AC-4: before typing, favourites, recent records and featured screens are offered without duplicates', () => {
    const favorites = visibleFavorites(['/analytics', '/e/partner'], big);
    const palette = buildPalette({ catalog: big, query: '  ', locale: 'ja', favorites, records });
    expect(palette.groups.map((group) => group.id)).toEqual(['favorites', 'records', 'screens']);
    const screens = palette.groups.find((group) => group.id === 'screens')?.options ?? [];
    expect(screens.every((option) => option.kind === 'screen' && option.entry.featured)).toBe(true);
    expect(screens.some((option) => option.kind === 'screen' && option.entry.href === '/analytics')).toBe(false);
    expect(new Set(palette.options.map((option) => option.key)).size).toBe(palette.options.length);
  });

  it('AC-2: arrow keys wrap around and do nothing without candidates', () => {
    expect(movePaletteSelection(0, 3, 1)).toBe(1);
    expect(movePaletteSelection(2, 3, 1)).toBe(0);
    expect(movePaletteSelection(0, 3, -1)).toBe(2);
    expect(movePaletteSelection(-1, 3, -1)).toBe(2);
    expect(movePaletteSelection(0, 0, 1)).toBe(-1);
  });
});

describe('navigation-assist AC-8: palette layout contract', () => {
  const css = readFileSync(new URL('../components/navigation-assist.css', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

  it('AC-8: below 480px the palette spans the whole viewport width from the top edge', () => {
    const phone = /@media \(max-width: 479px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    const rule = /\.action-dialog\.command-palette \{([^}]*)\}/.exec(phone)?.[1] ?? '';
    expect(rule).toContain('inset: 0 0 auto;');
    expect(rule).toContain('width: 100%;');
    // The UA's dialog max-width is lifted for every size, so 100% really is the viewport.
    expect(/\n\.action-dialog\.command-palette \{([^}]*)\}/.exec(css)?.[1]).toContain('max-width: none;');
  });

  it('AC-8: only the 480 / 768 px breakpoints and defined colour tokens are used', () => {
    const widths = [...css.matchAll(/@media[^{]*\((?:max|min)-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]));
    expect(widths.length).toBeGreaterThan(0);
    for (const width of widths) expect([479, 480, 767, 768]).toContain(width);
    const root = /\n:root \{([\s\S]*?)\n\}/.exec(styles)?.[1] ?? '';
    const defined = new Set([...root.matchAll(/--([\w-]+):/g)].map((m) => m[1]));
    const used = [...css.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((name) => !defined.has(name))).toEqual([]);
  });
});
