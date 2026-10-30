// docs/specs/list-workbench.md AC-4/AC-5: column layout and saved views in browser storage, per user/tenant/company/
// entity, with the strict reader/writer boundary of the saved analyses, and defaults when storage fails.
import { describe, expect, it } from 'vitest';
import type { EntityMeta, FieldMeta } from '../api/types.ts';
import {
  columnCandidates,
  deleteView,
  EMPTY_PREFS,
  isDefaultColumns,
  listStorageKey,
  ListStorageError,
  MAX_SAVED_VIEWS,
  moveColumn,
  mutateListPrefs,
  readListPrefs,
  resolveColumns,
  saveView,
  writeListPrefs,
  type ListLockManager,
  type ListStorage,
  type SavedListView,
} from './list-views.ts';

class MemoryStorage implements ListStorage {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

const field = (name: string, kind = 'text', extra: Partial<FieldMeta> = {}): FieldMeta => ({
  name,
  kind,
  label: { ja: name, en: name },
  required: false,
  hasDefault: false,
  hidden: false,
  immutable: false,
  ...extra,
});
const entity: EntityMeta = {
  name: 'sales_invoice',
  kind: 'document',
  label: { ja: '売上請求書', en: 'Sales invoice' },
  module: 'sales',
  scope: 'company',
  displayField: undefined,
  hasExt: true,
  fields: [
    field('partnerId', 'ref'),
    field('date', 'date'),
    field('total', 'decimal', { money: true }),
    field('note'),
    field('taxSummary', 'json'),
    field('cancelledDate', 'date', { hidden: true }),
  ],
  extFields: [field('ext.rank'), field('ext.secret', 'text', { hidden: true })],
  views: { list: ['partnerId', 'date', 'total'], form: 'auto', search: ['note'] },
  ops: ['read'],
};
const scope = { tenantId: 't1', userId: 'u1', companyId: 'c1' };
const view = (name: string, extra: Partial<SavedListView> = {}): SavedListView => ({
  id: `id-${name}`,
  name,
  updatedAt: '2026-10-29T00:00:00.000Z',
  ...extra,
});

describe('list-workbench AC-4/AC-5: storage boundary', () => {
  it('AC-4: the key is scoped by tenant, user, company and entity', () => {
    const key = listStorageKey(scope, 'sales_invoice');
    expect(key).toBe('daifuku.list.v1.["t1","u1","c1","sales_invoice"]');
    for (const other of [
      listStorageKey({ ...scope, tenantId: 't2' }, 'sales_invoice'),
      listStorageKey({ ...scope, userId: 'u2' }, 'sales_invoice'),
      listStorageKey({ ...scope, companyId: 'c2' }, 'sales_invoice'),
      listStorageKey(scope, 'partner'),
    ])
      expect(other).not.toBe(key);
  });

  it('AC-4/AC-5: writes pass the strict reader; the reader refuses foreign or extra data', () => {
    const storage = new MemoryStorage();
    const key = listStorageKey(scope, 'sales_invoice');
    expect(readListPrefs(storage, key)).toEqual(EMPTY_PREFS);
    const prefs = {
      columns: ['date', 'total'],
      views: [view('今月の下書き', { q: 'x', sort: 'date:desc', filters: { docstatus: [0] }, columns: ['date'] })],
    };
    writeListPrefs(storage, key, prefs);
    expect(readListPrefs(storage, key)).toEqual(prefs);
    for (const raw of [
      '{"version":1,"views":[],"extra":1}',
      '{"version":1,"views":[{"id":"a","name":"","updatedAt":"x"}]}',
      '{"version":1,"views":[{"id":"a","name":"n","updatedAt":"x","sort":":"}]}',
      '{"version":1,"columns":[],"views":[]}',
      '{"version":1,"columns":["a","a"],"views":[]}',
      'not json',
    ]) {
      storage.setItem(key, raw);
      expect(() => readListPrefs(storage, key)).toThrow();
    }
    expect(() => writeListPrefs(storage, key, { views: [view('x', { columns: [] })] })).toThrow();
    storage.setItem(key, '{"version":2,"views":[]}');
    expect(() => readListPrefs(storage, key)).toThrow(ListStorageError);
  });

  it('AC-4: a change runs under the Web Lock when there is one, and still works without it', async () => {
    const storage = new MemoryStorage();
    const key = listStorageKey(scope, 'sales_invoice');
    const locked: string[] = [];
    const locks: ListLockManager = {
      request: async (name, _options, callback) => {
        locked.push(name);
        return callback();
      },
    };
    await mutateListPrefs(storage, locks, key, (p) => ({ ...p, columns: ['total'] }));
    expect(locked).toEqual([key]);
    const next = await mutateListPrefs(storage, undefined, key, (p) => saveView(p, view('A')));
    expect(next).toEqual({ columns: ['total'], views: [view('A')] });
    expect(readListPrefs(storage, key)).toEqual(next);
  });

  it('AC-4: unreadable data of this version is replaced, data of a newer version is never overwritten', async () => {
    const storage = new MemoryStorage();
    const key = listStorageKey(scope, 'sales_invoice');
    storage.setItem(key, 'corrupt');
    expect(await mutateListPrefs(storage, undefined, key, (p) => ({ ...p, columns: ['date'] }))).toEqual({
      columns: ['date'],
      views: [],
    });
    storage.setItem(key, '{"version":2,"views":[]}');
    await expect(mutateListPrefs(storage, undefined, key, (p) => p)).rejects.toBeInstanceOf(ListStorageError);
    expect(storage.getItem(key)).toBe('{"version":2,"views":[]}');
  });

  it('AC-4: a storage that throws surfaces as an error the page turns into the defaults', async () => {
    const blocked: ListStorage = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    expect(() => readListPrefs(blocked, 'k')).toThrow();
    await expect(mutateListPrefs(blocked, undefined, 'k', (p) => p)).rejects.toThrow();
  });
});

describe('list-workbench AC-4: columns', () => {
  it('AC-4: the chooser offers visible fields and ext fields, not JSON, hidden or the fixed document columns', () => {
    expect(columnCandidates(entity).map((f) => f.name)).toEqual(['partnerId', 'date', 'total', 'note', 'ext.rank']);
  });

  it('AC-4: stored names resolve in order, unknown names drop, nothing left (or nothing stored) = views.list', () => {
    expect(resolveColumns(entity, ['total', 'ext.rank', 'gone']).map((f) => f.name)).toEqual(['total', 'ext.rank']);
    expect(resolveColumns(entity, ['gone']).map((f) => f.name)).toEqual(['partnerId', 'date', 'total']);
    expect(resolveColumns(entity, undefined).map((f) => f.name)).toEqual(['partnerId', 'date', 'total']);
    expect(isDefaultColumns(entity, ['partnerId', 'date', 'total'])).toBe(true);
    expect(isDefaultColumns(entity, ['date', 'partnerId', 'total'])).toBe(false);
  });

  it('AC-4: moving a column up or down keeps the others in order', () => {
    expect(moveColumn(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveColumn(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveColumn(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });
});

describe('list-workbench AC-5: saved views', () => {
  it('AC-5: saving puts the newest first, the same name replaces, deleting removes', () => {
    let prefs = saveView(EMPTY_PREFS, view('A'));
    prefs = saveView(prefs, view('B'));
    expect(prefs.views.map((v) => v.name)).toEqual(['B', 'A']);
    prefs = saveView(prefs, view('A', { id: 'new-id', q: 'again' }));
    expect(prefs.views.map((v) => [v.name, v.id])).toEqual([
      ['A', 'new-id'],
      ['B', 'id-B'],
    ]);
    expect(deleteView(prefs, 'id-B').views.map((v) => v.name)).toEqual(['A']);
  });

  it(`AC-5: at most ${MAX_SAVED_VIEWS} views`, () => {
    let prefs = EMPTY_PREFS;
    for (let i = 0; i < MAX_SAVED_VIEWS; i += 1) prefs = saveView(prefs, view(`v${i}`));
    expect(() => saveView(prefs, view('one more'))).toThrow();
    expect(saveView(prefs, view('v3', { id: 'replaced' })).views).toHaveLength(MAX_SAVED_VIEWS);
  });
});
