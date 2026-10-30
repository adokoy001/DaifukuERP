// docs/specs/form-ergonomics.md: the pure rules of the generic form — section parsing (AC-1/AC-2), required marks
// (AC-4), the error summary (AC-3), the keyboard decisions (AC-5/AC-6), unsaved-input drafts (AC-8) and the list
// position (AC-9). The browser behaviour is in apps/web/e2e/form-ergonomics.spec.ts.
import { describe, expect, it } from 'vitest';
import type { EntityMeta, FieldMeta } from '../api/types.ts';
import { assistStorageKey } from './assist-storage.ts';
import { errorSummary, firstTarget } from './form-errors.ts';
import {
  applyDraft,
  buildDraft,
  DRAFT_MAX_AGE_MS,
  draftKey,
  draftOffer,
  draftTarget,
  forgetDrafts,
  parseDraft,
  readDraft,
  removeDraft,
  serializeDraft,
  writeDraft,
  type DraftKeyedStorage,
} from './form-draft.ts';
import { advanceAction, formShortcut, gridKey, movedIndex, nextCell, type KeyLike } from './form-shortcuts.ts';
import { formGroups, formSections, needsInput, sectionLayout } from './form.ts';
import type { GridRow } from './lines.ts';
import {
  adjacentSearch,
  listStateOf,
  recordNavFromState,
  recordNavState,
  recordPosition,
  type RecordNav,
} from './record-nav.ts';

const field = (name: string, kind: string, extra: Partial<FieldMeta> = {}): FieldMeta => ({
  name,
  kind,
  label: { ja: `${name}(ja)`, en: name },
  required: false,
  hasDefault: false,
  hidden: false,
  immutable: false,
  ...extra,
});

const partnerFields = [
  field('code', 'text', { required: true }),
  field('name', 'text', { required: true }),
  field('phone', 'text'),
  field('email', 'text'),
  field('bankName', 'text'),
  field('notes', 'text', { multiline: true }),
  field('isActive', 'bool', { required: true, hasDefault: true }),
  field('secret', 'text', { hidden: true }),
];

function entity(form: EntityMeta['views']['form'], extra: Partial<EntityMeta> = {}): EntityMeta {
  return {
    name: 'partner',
    kind: 'entity',
    label: { ja: '取引先', en: 'Partner' },
    module: 'partner',
    scope: 'company',
    displayField: 'name',
    hasExt: false,
    fields: partnerFields,
    views: { list: ['code', 'name'], form, search: ['name'] },
    ops: ['read', 'create', 'update'],
    ...extra,
  };
}

const L = (ja: string, en: string) => ({ ja, en });

describe('form-ergonomics AC-1/AC-2: sections from views.form', () => {
  it('AC-1: labelled { label, fields } groups keep their label; plain string[] groups have none', () => {
    const sections = formSections(
      entity([{ label: L('基本', 'Basics'), fields: ['code', 'name'] }, ['phone', 'email'], ['notes']]),
    );
    expect(sections.map((s) => [s.key, s.label?.en ?? null, s.fields.map((f) => f.name)])).toEqual([
      ['g0', 'Basics', ['code', 'name']],
      ['g1', null, ['phone', 'email']],
      ['g2', null, ['notes']],
      ['rest', null, ['bankName', 'isActive']],
    ]);
  });

  it('AC-1: the original string[][] form gives the same groups as before (formGroups)', () => {
    const groups = formGroups(entity([['name', 'code'], ['nope', 'secret', 'phone'], ['name']]));
    expect(groups.map((g) => g.map((f) => f.name))).toEqual([
      ['name', 'code'],
      ['phone'],
      ['email', 'bankName', 'notes', 'isActive'],
    ]);
    expect(formSections(entity('auto')).map((s) => s.key)).toEqual(['auto']);
  });

  it('AC-1: a labelled group whose fields are all masked or unknown is dropped with its label', () => {
    const sections = formSections(
      entity([
        { label: L('口座', 'Bank'), fields: ['bankAccountNo'] },
        { label: L('基本', 'Basics'), fields: ['code'] },
      ]),
    );
    expect(sections.map((s) => s.label?.en ?? s.key)).toEqual(['Basics', 'rest']);
  });

  it('AC-2: tabs only on a narrow screen with at least 4 labelled sections', () => {
    const labelled = (n: number) => Array.from({ length: n }, (_, i) => ({ label: L(`節${i}`, `S${i}`) }));
    expect(sectionLayout(labelled(4), true)).toBe('tabs');
    expect(sectionLayout(labelled(4), false)).toBe('stack');
    expect(sectionLayout(labelled(3), true)).toBe('stack');
    expect(sectionLayout([...labelled(3), {}, {}], true)).toBe('stack');
  });
});

describe('form-ergonomics AC-4: required marks', () => {
  it('AC-4: marked when required, without a default, editable and not server-owned', () => {
    expect(needsInput(field('name', 'text', { required: true }), true)).toBe(true);
    expect(needsInput(field('name', 'text', { required: true }), false)).toBe(false);
    expect(needsInput(field('isActive', 'bool', { required: true, hasDefault: true }), true)).toBe(false);
    expect(needsInput(field('total', 'decimal', { required: true, serverOwned: true }), true)).toBe(false);
    expect(needsInput(field('phone', 'text'), true)).toBe(false);
  });
});

describe('form-ergonomics AC-3: error summary', () => {
  const line: EntityMeta = {
    ...entity('auto'),
    name: 'sales_invoice_line',
    label: L('売上明細', 'Invoice line'),
    fields: [field('description', 'text'), field('quantity', 'decimal'), field('seq', 'int')],
  };
  const rows: GridRow[] = [
    { key: 'r1', values: {} },
    { key: 'r2', values: {} },
  ];
  const sections = formSections(entity([{ label: L('基本', 'Basics'), fields: ['code', 'name'] }, ['phone']]));

  it('AC-3: form messages first, then header fields in form order, then cells by row with row number and column', () => {
    const items = errorSummary({
      sections,
      allFields: partnerFields,
      fieldErrors: { phone: 'bad phone', name: 'required', secret: 'hidden problem' },
      formErrors: ['over allocated'],
      lines: [
        {
          line,
          columns: [line.fields[0] as FieldMeta, line.fields[1] as FieldMeta],
          rows,
          errors: { r2: { quantity: 'number expected', seq: 'server issue' }, r1: { description: 'required' } },
        },
      ],
    });
    expect(items.map((i) => [i.message, i.targetId ?? null, i.section ?? null, i.line?.row ?? null])).toEqual([
      ['over allocated', null, null, null],
      ['required', 'f-name', 'g0', null],
      ['bad phone', 'f-phone', 'g1', null],
      ['hidden problem', null, null, null],
      ['required', 'l-sales_invoice_line-r1-description', null, 1],
      ['number expected', 'l-sales_invoice_line-r2-quantity', null, 2],
      ['server issue', null, null, 2],
    ]);
    expect(items[3]?.field).toEqual(L('secret(ja)', 'secret'));
    expect(items[6]?.field).toEqual(L('seq(ja)', 'seq'));
    expect(firstTarget(items)?.targetId).toBe('f-name');
  });

  it('AC-3: no errors, no items (the summary disappears once every input is fixed)', () => {
    expect(errorSummary({ sections, allFields: partnerFields, fieldErrors: {}, formErrors: [], lines: [] })).toEqual(
      [],
    );
  });
});

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('form-ergonomics AC-5: Ctrl/⌘+S and Ctrl/⌘+Enter', () => {
  it('AC-5: the platform modifier only; not with Alt/Shift or during IME composition', () => {
    expect(formShortcut(key('s', { ctrlKey: true }), false)).toBe('save');
    expect(formShortcut(key('S', { ctrlKey: true }), false)).toBe('save');
    expect(formShortcut(key('ß', { ctrlKey: true, code: 'KeyS' }), false)).toBe('save');
    expect(formShortcut(key('s', { metaKey: true }), true)).toBe('save');
    expect(formShortcut(key('s', { metaKey: true }), false)).toBeUndefined();
    expect(formShortcut(key('s', { ctrlKey: true }), true)).toBeUndefined();
    expect(formShortcut(key('s', { ctrlKey: true, shiftKey: true }), false)).toBeUndefined();
    expect(formShortcut(key('s', { ctrlKey: true, altKey: true }), false)).toBeUndefined();
    expect(formShortcut(key('s', { ctrlKey: true, isComposing: true }), false)).toBeUndefined();
    expect(formShortcut(key('Enter', { ctrlKey: true }), false)).toBe('advance');
    expect(formShortcut(key('Enter'), false)).toBeUndefined();
    expect(formShortcut(key('k', { ctrlKey: true }), false)).toBeUndefined();
  });

  it('AC-5: Ctrl+Enter saves unsaved work, opens the submit confirmation of a clean draft, and saves otherwise', () => {
    const ctx = { isNew: false, dirty: false, canSave: true, canSubmit: true };
    expect(advanceAction(ctx)).toBe('submit');
    expect(advanceAction({ ...ctx, dirty: true })).toBe('save');
    expect(advanceAction({ ...ctx, isNew: true })).toBe('save');
    expect(advanceAction({ ...ctx, canSubmit: false })).toBe('save');
    expect(advanceAction({ ...ctx, dirty: true, canSave: false })).toBeUndefined();
    expect(advanceAction({ ...ctx, canSubmit: false, canSave: false })).toBeUndefined();
  });
});

describe('form-ergonomics AC-6: line grid keys', () => {
  it('AC-6: Enter without modifiers is "next"; Alt+↑/↓ move the row', () => {
    expect(gridKey(key('Enter'))).toBe('next');
    expect(gridKey(key('Enter', { shiftKey: true }))).toBeUndefined();
    expect(gridKey(key('Enter', { ctrlKey: true }))).toBeUndefined();
    expect(gridKey(key('Enter', { isComposing: true }))).toBeUndefined();
    expect(gridKey(key('ArrowUp', { altKey: true }))).toBe('move-up');
    expect(gridKey(key('ArrowDown', { altKey: true }))).toBe('move-down');
    expect(gridKey(key('ArrowDown'))).toBeUndefined();
    expect(gridKey(key('ArrowDown', { altKey: true, ctrlKey: true }))).toBeUndefined();
  });

  it('AC-6: next cell in the row, then the next row, then a new row after the last cell of the last row', () => {
    const editable = ['productId', 'quantity', 'unitPrice'];
    expect(nextCell(editable, 2, 0, 'productId')).toEqual({ row: 0, field: 'quantity' });
    expect(nextCell(editable, 2, 0, 'unitPrice')).toEqual({ row: 1, field: 'productId' });
    expect(nextCell(editable, 2, 1, 'unitPrice')).toBe('add');
    expect(nextCell(editable, 2, 1, 'amount')).toBe('add');
    expect(nextCell(editable, 2, 0, 'amount')).toEqual({ row: 1, field: 'productId' });
    expect(nextCell([], 2, 0, 'productId')).toBeUndefined();
    expect(nextCell(editable, 2, 5, 'productId')).toBeUndefined();
  });

  it('AC-6: a row moves one place and stops at the edges', () => {
    expect(movedIndex(1, 3, 'move-up')).toBe(0);
    expect(movedIndex(1, 3, 'move-down')).toBe(2);
    expect(movedIndex(0, 3, 'move-up')).toBeUndefined();
    expect(movedIndex(2, 3, 'move-down')).toBeUndefined();
  });
});

class MemoryStorage implements DraftKeyedStorage {
  readonly map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

describe('form-ergonomics AC-8: unsaved-input drafts', () => {
  const scope = { tenantId: 't1', userId: 'u1', companyId: 'c1' };
  const lineEntity: EntityMeta = {
    ...entity('auto'),
    name: 'sales_invoice_line',
    fields: [
      field('description', 'text'),
      field('quantity', 'decimal'),
      field('amount', 'decimal', { serverOwned: true }),
    ],
  };
  const columns = lineEntity.fields;
  const specs = [{ line: lineEntity, columns }];
  const invoice: EntityMeta = {
    ...entity('auto'),
    name: 'sales_invoice',
    kind: 'document',
    fields: [
      field('partnerId', 'ref', { required: true }),
      field('note', 'text'),
      field('priceIncludesTax', 'bool', { required: true, hasDefault: true }),
      field('total', 'decimal', { serverOwned: true }),
      field('bankAccountNo', 'text', { restricted: true }),
    ],
    extFields: [field('ext.rank', 'text')],
  };
  const base = {
    partnerId: 'p1',
    note: '',
    priceIncludesTax: false,
    total: '100',
    bankAccountNo: '123',
    'ext.rank': '',
  };
  const baseLines: Record<string, GridRow[]> = {
    sales_invoice_line: [{ key: 'r1', id: 'l1', values: { description: 'A', quantity: '1', amount: '100' } }],
  };
  const now = '2026-10-30T01:00:00.000Z';

  it('AC-8: the key is per user, tenant, company, entity and target; incomplete scope or personal data -> none', () => {
    const k = draftKey(scope, 'sales_invoice', 'new');
    expect(k).toBe('daifuku.form-draft.v1.["t1","u1","c1","sales_invoice","new"]');
    expect(draftKey({ ...scope, userId: 'u2' }, 'sales_invoice', 'new')).not.toBe(k);
    expect(draftKey({ ...scope, companyId: 'c2' }, 'sales_invoice', 'new')).not.toBe(k);
    expect(draftKey({ ...scope, companyId: '' }, 'sales_invoice', 'new')).toBeUndefined();
    expect(draftKey(undefined, 'sales_invoice', 'new')).toBeUndefined();
    expect(draftKey(scope, 'workforce_employee', 'new')).toBeUndefined();
    expect(draftKey(scope, 'filing_payroll_report', 'x')).toBeUndefined();
    // the same boundary as the browser-local lists of navigation-assist
    expect(assistStorageKey('recent', scope)).toContain(JSON.stringify(['t1', 'u1', 'c1']));
    expect(draftTarget('id-1', 'seed')).toBe('id-1');
    expect(draftTarget(undefined, 'seed-9')).toBe('new:seed-9');
    expect(draftTarget(undefined, undefined)).toBe('new');
  });

  it('AC-8: only changed, writable, unrestricted values and the rows of changed grids are stored', () => {
    const draft = buildDraft({
      entity: invoice,
      target: 'inv-1',
      baseVersion: 3,
      now,
      values: { ...base, note: 'typed', total: '999', bankAccountNo: '999', priceIncludesTax: true, 'ext.rank': 'A' },
      baseline: base,
      lines: {
        sales_invoice_line: [
          { key: 'r9', id: 'l1', values: { description: 'A', quantity: '2', amount: '100' } },
          { key: 'r10', values: { description: 'new', quantity: '1', amount: '' } },
        ],
      },
      baselineLines: baseLines,
      specs,
    });
    expect(draft).toEqual({
      entity: 'sales_invoice',
      target: 'inv-1',
      baseVersion: 3,
      savedAt: now,
      values: { note: 'typed', priceIncludesTax: true, 'ext.rank': 'A' },
      lines: {
        sales_invoice_line: [
          { id: 'l1', values: { description: 'A', quantity: '2' } },
          { values: { description: 'new', quantity: '1' } },
        ],
      },
    });
    expect(JSON.stringify(draft)).not.toContain('999');
  });

  it('AC-8: nothing storable changed -> no draft (a change to a restricted or server-owned field alone keeps none)', () => {
    const args = {
      entity: invoice,
      target: 'inv-1',
      baseVersion: 3,
      now,
      baseline: base,
      baselineLines: baseLines,
      specs,
    };
    expect(buildDraft({ ...args, values: base, lines: baseLines })).toBeUndefined();
    expect(
      buildDraft({ ...args, values: { ...base, bankAccountNo: 'x', total: '1' }, lines: baseLines }),
    ).toBeUndefined();
  });

  it('AC-8: write, read back, version check, and remove; a draft for another target or too old reads as none', () => {
    const storage = new MemoryStorage();
    const k = draftKey(scope, 'sales_invoice', 'inv-1');
    const draft = {
      entity: 'sales_invoice',
      target: 'inv-1',
      baseVersion: 3,
      savedAt: now,
      values: { note: 'typed' },
      lines: {},
    };
    expect(writeDraft(storage, k, draft)).toBe(true);
    const at = Date.parse(now) + 1000;
    const read = readDraft(storage, k, 'sales_invoice', 'inv-1', at);
    expect(read).toEqual(draft);
    expect(draftOffer(draft, 3)).toBe('offer');
    expect(draftOffer(draft, 4)).toBe('stale');
    expect(draftOffer({ ...draft, baseVersion: null }, undefined)).toBe('offer');
    expect(readDraft(storage, k, 'sales_invoice', 'inv-2', at)).toBeUndefined();
    expect(
      parseDraft(serializeDraft(draft), 'sales_invoice', 'inv-1', Date.parse(now) + DRAFT_MAX_AGE_MS + 1),
    ).toBeUndefined();
    expect(parseDraft('{"version":1,"entity":"sales_invoice"', 'sales_invoice', 'inv-1', at)).toBeUndefined();
    expect(
      parseDraft(
        JSON.stringify({ ...JSON.parse(serializeDraft(draft)), values: { note: 5 } }),
        'sales_invoice',
        'inv-1',
        at,
      ),
    ).toBeUndefined();
    removeDraft(storage, k);
    expect(readDraft(storage, k, 'sales_invoice', 'inv-1', at)).toBeUndefined();
  });

  it('AC-8: a storage that refuses writes or cannot be read reports false / none instead of throwing', () => {
    const broken: DraftKeyedStorage = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const k = draftKey(scope, 'sales_invoice', 'new');
    const draft = { entity: 'sales_invoice', target: 'new', baseVersion: null, savedAt: now, values: {}, lines: {} };
    expect(writeDraft(broken, k, draft)).toBe(false);
    expect(readDraft(broken, k, 'sales_invoice', 'new', Date.parse(now))).toBeUndefined();
    expect(() => removeDraft(broken, k)).not.toThrow();
    expect(writeDraft(undefined, k, draft)).toBe(false);
  });

  it('AC-8: restore applies stored values over the base; restricted, read-only and removed fields are not applied', () => {
    const restored = applyDraft(
      {
        entity: 'sales_invoice',
        target: 'inv-1',
        baseVersion: 3,
        savedAt: now,
        values: { note: 'typed', total: '1', bankAccountNo: 'x', gone: 'y', priceIncludesTax: 'yes' },
        lines: {
          sales_invoice_line: [
            { id: 'l1', values: { quantity: '5', amount: '1' } },
            { id: 'deleted-row', values: { quantity: '7' } },
            { values: { description: 'new row' } },
          ],
        },
      },
      { entity: invoice, values: base, lines: baseLines, specs },
    );
    expect(restored.values).toEqual({ ...base, note: 'typed' });
    expect(restored.lines.sales_invoice_line?.map((r) => [r.id ?? null, r.values])).toEqual([
      ['l1', { description: 'A', quantity: '5', amount: '100' }],
      [null, { description: 'new row', quantity: '', amount: '' }],
    ]);
  });

  it('AC-8: explicit sign-out removes every form draft of the tab and nothing else', () => {
    const storage = new MemoryStorage();
    storage.setItem('daifuku.token', 'x');
    writeDraft(storage, draftKey(scope, 'partner', 'new'), {
      entity: 'partner',
      target: 'new',
      baseVersion: null,
      savedAt: now,
      values: { name: 'a' },
      lines: {},
    });
    writeDraft(storage, draftKey({ ...scope, userId: 'u2' }, 'partner', 'p1'), {
      entity: 'partner',
      target: 'p1',
      baseVersion: 1,
      savedAt: now,
      values: { name: 'b' },
      lines: {},
    });
    expect(forgetDrafts(storage)).toBe(2);
    expect([...storage.map.keys()]).toEqual(['daifuku.token']);
  });
});

describe('form-ergonomics AC-9: previous / next within the list', () => {
  const ids = Array.from({ length: 3 }, (_, i) => `0192a8b0-0000-7000-8000-00000000000${i + 1}`);
  const nav: RecordNav = { entity: 'partner', ids, search: { q: 'acme', page: 2, sort: 'name:asc' }, total: 103 };
  const owner = 't1:u1:c1';

  it('AC-9: the position comes back from history state only for the same entity and session', () => {
    const state = { ...recordNavState(nav, owner), other: 1 };
    expect(recordNavFromState(state, 'partner', owner)).toEqual(nav);
    expect(recordNavFromState(state, 'product', owner)).toBeUndefined();
    expect(recordNavFromState(state, 'partner', 't1:u2:c1')).toBeUndefined();
    expect(recordNavFromState({ recordNav: { ...nav, owner, ids: ['not-a-uuid'] } }, 'partner', owner)).toBeUndefined();
    expect(recordNavFromState({ recordNav: { ...nav, owner, total: 1 } }, 'partner', owner)).toBeUndefined();
    expect(recordNavFromState(undefined, 'partner', owner)).toBeUndefined();
  });

  it('AC-9: neighbours on the page, and the neighbouring page at the edges', () => {
    expect(recordPosition(nav, ids[1] as string)).toEqual({
      ordinal: 52,
      total: 103,
      prev: ids[0],
      next: ids[2],
      prevPage: false,
      nextPage: false,
    });
    expect(recordPosition(nav, ids[0] as string)).toMatchObject({ ordinal: 51, prevPage: true, nextPage: false });
    expect(recordPosition(nav, ids[2] as string)).toMatchObject({ ordinal: 53, prevPage: false, nextPage: true });
    const lastPage = { ...nav, total: 53 };
    expect(recordPosition(lastPage, ids[2] as string)).toMatchObject({ nextPage: false });
    const firstPage = { ...nav, search: { q: 'acme' } };
    expect(recordPosition(firstPage, ids[0] as string)).toMatchObject({ ordinal: 1, prevPage: false });
    expect(recordPosition(nav, 'elsewhere')).toBeUndefined();
  });

  it('AC-9: the neighbouring page keeps the criteria; page 1 has no page key; the query matches the list', () => {
    expect(adjacentSearch(nav.search, 'next')).toEqual({ q: 'acme', page: 3, sort: 'name:asc' });
    expect(adjacentSearch(nav.search, 'prev')).toEqual({ q: 'acme', sort: 'name:asc' });
    const state = listStateOf(entity('auto'), { q: 'acme', page: 3, f: { code: 'C-1' } });
    expect(state).toMatchObject({ search: 'acme', page: 3 });
  });
});
