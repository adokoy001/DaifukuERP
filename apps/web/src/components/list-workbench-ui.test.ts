// docs/specs/list-workbench.md AC-2/AC-10/AC-12: the filter form's draft rules and the bulk selection UI, rendered
// statically (no browser): invalid drafts are named and not applied; rows left out of an operation are shown.
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { EntityMeta, FieldMeta, RecordJson } from '../api/types.ts';
import { LocaleProvider } from '../i18n.tsx';
import { filterDefs } from '../lib/list-filters.ts';
import { DataTable } from './data-table.tsx';
import { BulkBar } from './list-bulk.tsx';
import { draftToFilters, ListFilterPanel } from './list-filter-panel.tsx';

const render = (element: ReactElement) => renderToStaticMarkup(h(LocaleProvider, null, element));
const field = (name: string, kind: string, extra: Partial<FieldMeta> = {}): FieldMeta => ({
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
  name: 'journal_entry',
  kind: 'document',
  label: { ja: '仕訳', en: 'Journal entry' },
  module: 'accounting',
  scope: 'company',
  displayField: 'description',
  hasExt: false,
  fields: [
    field('date', 'date', { label: { ja: '日付', en: 'Date' } }),
    field('description', 'text'),
    field('totalDebit', 'decimal', { money: true, label: { ja: '借方合計', en: 'Total debit' } }),
    field('lines', 'int'),
    field('posted', 'bool', { label: { ja: '転記済', en: 'Posted' } }),
  ],
  views: { list: ['date', 'description', 'totalDebit', 'lines', 'posted'], form: 'auto', search: ['description'] },
  ops: ['read', 'submit', 'cancel', 'delete'],
};
const defs = filterDefs(entity);
const row = (id: string, docstatus: 0 | 1 | 2, extra: Record<string, unknown> = {}): RecordJson =>
  ({
    id,
    tenantId: 't',
    companyId: 'c',
    createdAt: '',
    updatedAt: '',
    createdBy: null,
    updatedBy: null,
    version: 1,
    docstatus,
    ...extra,
  }) as RecordJson;

describe('list-workbench AC-2: filter draft', () => {
  it('AC-2: empty controls are skipped, valid ones become filters, invalid ones are named and not applied', () => {
    expect(
      draftToFilters(defs, {
        docstatus: [0, 1],
        date: { from: '2026-10-01', to: '' },
        totalDebit: { min: ' 100 ', max: '' },
        lines: { min: '', max: '' },
        posted: 'false',
      }),
    ).toEqual({
      filters: { docstatus: [0, 1], date: { from: '2026-10-01' }, totalDebit: { min: '100' }, posted: false },
      invalid: [],
    });
    expect(
      draftToFilters(defs, {
        date: { from: '2026-10-31', to: '2026-10-01' },
        totalDebit: { min: 'abc', max: '' },
        lines: { min: '1.5', max: '' },
      }),
    ).toEqual({ filters: {}, invalid: ['date', 'totalDebit', 'lines'] });
  });

  it('AC-12: the form shows labelled controls for every filter kind in the current language', () => {
    const markup = render(h(ListFilterPanel, { id: 'f', defs, filters: { docstatus: [0] }, onApply: () => undefined }));
    for (const text of ['状態', '下書き', '確定', '取消', '日付', '開始', '終了', '借方合計', '最小', '最大', '転記済'])
      expect(markup).toContain(text);
    expect(markup).toContain('指定なし');
    expect(markup).toContain('>絞り込む</button>');
    expect(markup).toContain('>すべてクリア</button>');
  });
});

describe('list-workbench AC-10: bulk selection UI', () => {
  it('AC-10: the bar shows the selection, eligible counts per operation and the rows left out with the reason', () => {
    const markup = render(
      h(BulkBar, {
        ops: ['submit', 'cancel', 'delete'],
        selected: [row('a', 0), row('b', 0), row('c', 1)],
        busy: false,
        onChoose: () => undefined,
        onClear: () => undefined,
      }),
    );
    expect(markup).toContain('3 件を選択中（1 回 100 件まで）');
    expect(markup).toContain('確定（2）');
    expect(markup).toContain('取消（1）');
    expect(markup).toContain('削除（2）');
    expect(markup).toContain('確定: 1 件は下書きでないため対象外');
    expect(markup).toContain('取消: 2 件は確定済みでないため対象外');
  });

  it('AC-11: while a run is active every operation button is disabled', () => {
    const markup = render(
      h(BulkBar, {
        ops: ['submit'],
        selected: [row('a', 0)],
        busy: true,
        onChoose: () => undefined,
        onClear: () => undefined,
      }),
    );
    expect(markup).toMatch(/<button type="button" class="btn btn-sm" disabled="">確定（1）<\/button>/);
  });

  it('AC-10: a selectable table leads with a page checkbox and one labelled checkbox per row', () => {
    const rows = [row('r1', 0, { description: '一行目' }), row('r2', 1, { number: 'JE-1' })];
    const markup = render(
      h(DataTable, {
        entity,
        columns: entity.fields.filter((f) => f.name === 'description'),
        rows,
        sort: undefined,
        onSortChange: () => undefined,
        onRowClick: () => undefined,
        refLabel: () => undefined,
        loading: false,
        selection: {
          isSelected: (r: RecordJson) => r.id === 'r2',
          onToggle: () => undefined,
          onTogglePage: () => undefined,
          rowLabel: (r: RecordJson) => `選択: ${String(r.number ?? r.description)}`,
          pageLabel: 'このページの行をすべて選択',
        },
      }),
    );
    expect(markup).toContain('aria-label="このページの行をすべて選択"');
    expect(markup).toContain('aria-label="選択: 一行目"');
    expect(markup).toContain('aria-label="選択: JE-1"');
    expect(markup).toMatch(
      /class="ui-row-link is-selected"[^>]*data-id="r2"|data-id="r2"[^>]*class="ui-row-link is-selected"/,
    );
  });
});
