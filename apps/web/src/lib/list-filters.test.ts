// docs/specs/list-workbench.md AC-1..AC-3: filter controls from meta, URL value <-> filters, filters -> kernel Domain.
import { describe, expect, it } from 'vitest';
import type { EntityMeta, FieldMeta } from '../api/types.ts';
import {
  activeFilterCount,
  businessDateField,
  describeFilter,
  effectiveFilters,
  filterDefs,
  filtersToDomain,
  linkFilters,
  parseFilters,
  withFilter,
} from './list-filters.ts';
import { parseListSearch, updateSearch } from './query.ts';

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

const invoice: EntityMeta = {
  name: 'sales_invoice',
  kind: 'document',
  label: { ja: '売上請求書', en: 'Sales invoice' },
  module: 'sales',
  scope: 'company',
  displayField: undefined,
  hasExt: false,
  fields: [
    field('partnerId', 'ref', { ref: 'partner' }),
    field('date', 'date'),
    field('dueDate', 'date'),
    field('total', 'decimal', { money: true }),
    field('lineCount', 'int'),
    field('status', 'enum', {
      values: ['draft', 'open', 'paid'],
      valueLabels: { draft: { ja: '下書き', en: 'Draft' }, open: { ja: '未入金', en: 'Open' } },
    }),
    field('priceIncludesTax', 'bool'),
    field('note', 'text'),
    field('createdOn', 'timestamp'),
    field('secretFlag', 'bool', { hidden: true }),
  ],
  views: {
    list: ['partnerId', 'dueDate', 'total', 'lineCount', 'status', 'createdOn', 'ext.rank', 'secretFlag'],
    form: 'auto',
    search: ['note', 'priceIncludesTax'],
  },
  ops: ['read', 'submit'],
};
const partner: EntityMeta = {
  ...invoice,
  name: 'partner',
  kind: 'entity',
  fields: [field('code', 'text'), field('isCustomer', 'bool'), field('postingDate', 'date')],
  views: { list: ['code', 'isCustomer'], form: 'auto', search: ['code'] },
};
const defs = filterDefs(invoice);
const PARTNER_ID = '0d4a3a9e-5b8f-4d7e-9a1b-2c3d4e5f6a7b';

describe('list-workbench AC-1: filter controls from meta', () => {
  it('AC-1: document state, business date, then list and search fields with a control kind', () => {
    expect(defs.map((d) => [d.key, d.kind])).toEqual([
      ['docstatus', 'docstatus'],
      ['date', 'date'],
      ['partnerId', 'ref'],
      ['dueDate', 'date'],
      ['total', 'range'],
      ['lineCount', 'range'],
      ['status', 'enum'],
      ['priceIncludesTax', 'bool'],
    ]);
    expect(defs.find((d) => d.key === 'lineCount')?.integer).toBe(true);
  });

  it('AC-1: text, timestamps, ext and hidden fields get no control; entities have no state filter', () => {
    const keys = defs.map((d) => d.key);
    for (const key of ['note', 'createdOn', 'ext.rank', 'secretFlag']) expect(keys).not.toContain(key);
    expect(filterDefs(partner).map((d) => d.key)).toEqual(['postingDate', 'isCustomer']);
    expect(businessDateField(partner)?.name).toBe('postingDate');
  });
});

describe('list-workbench AC-2: URL value and REST where', () => {
  it('AC-2: valid filters survive the URL round trip and become a Domain', () => {
    const filters = {
      docstatus: [0],
      date: { from: '2026-10-01', to: '2026-10-31' },
      partnerId: PARTNER_ID,
      total: { min: '1000', max: '99999.5' },
      lineCount: { min: '2' },
      status: ['open', 'draft'],
      priceIncludesTax: false,
    };
    const url = parseListSearch({ f: JSON.stringify(filters) });
    const parsed = parseFilters(url.f, defs);
    expect(parsed).toEqual({ ...filters, status: ['draft', 'open'] });
    expect(filtersToDomain(parsed, defs)).toEqual({
      docstatus: { $in: [0] },
      date: { $gte: '2026-10-01', $lte: '2026-10-31' },
      partnerId: PARTNER_ID,
      total: { $gte: '1000', $lte: '99999.5' },
      lineCount: { $gte: 2 },
      status: { $in: ['draft', 'open'] },
      priceIncludesTax: false,
    });
    // Money bounds stay decimal strings; they are never turned into floats.
    expect(typeof (filtersToDomain(parsed, defs)?.total as { $gte: unknown }).$gte).toBe('string');
  });

  it('AC-2: invalid conditions are ignored, not fatal', () => {
    expect(
      parseFilters(
        {
          docstatus: [0, 7],
          date: { from: '2026-02-30' },
          dueDate: { from: '2026-10-31', to: '2026-10-01' },
          partnerId: 'not-a-uuid',
          total: { min: '1e3' },
          lineCount: { min: '1.5' },
          status: ['open', 'unknown'],
          priceIncludesTax: 'yes',
          unknownField: 1,
          note: 'x',
        },
        defs,
      ),
    ).toEqual({});
    expect(parseFilters('garbage', defs)).toEqual({});
    expect(parseListSearch({ f: '{not json' })).toEqual({});
    expect(parseListSearch({ f: '[1,2]' })).toEqual({});
    expect(parseListSearch({ f: { a: 'x'.repeat(4000) } })).toEqual({});
    expect(filtersToDomain({}, defs)).toBeUndefined();
  });

  it('AC-2: every state selected means no state condition; one-sided ranges send one bound', () => {
    expect(filtersToDomain(parseFilters({ docstatus: [2, 1, 0] }, defs), defs)).toBeUndefined();
    expect(filtersToDomain(parseFilters({ total: { max: '-5' } }, defs), defs)).toEqual({ total: { $lte: '-5' } });
  });

  it('AC-2: changing the filters resets the page and replaces the link parameters', () => {
    const prev = parseListSearch({ q: 'x', page: '3', status: 'draft', from: '2026-10-01', to: '2026-10-31' });
    expect(updateSearch(prev, { f: { docstatus: [1] } })).toEqual({ q: 'x', f: { docstatus: [1] } });
    expect(updateSearch({ f: { docstatus: [1] }, page: 2 }, { f: undefined })).toEqual({});
    expect(updateSearch({ f: { docstatus: [1] } }, { page: 2 })).toEqual({ f: { docstatus: [1] }, page: 2 });
  });

  it('AC-2: withFilter sets, replaces and removes one filter; chips describe values in the locale', () => {
    const one = withFilter({}, defs, 'status', ['open']);
    expect(one).toEqual({ status: ['open'] });
    expect(withFilter(one, defs, 'status', undefined)).toEqual({});
    expect(withFilter(one, defs, 'status', ['bogus'])).toEqual({});
    expect(activeFilterCount({ ...one, docstatus: [0] })).toBe(2);
    const status = defs.find((d) => d.key === 'status');
    const state = defs.find((d) => d.key === 'docstatus');
    const range = defs.find((d) => d.key === 'total');
    if (!status || !state || !range) throw new Error('missing defs');
    expect(describeFilter(status, ['draft', 'open'], 'ja')).toBe('下書き・未入金');
    expect(describeFilter(state, [0, 2], 'en')).toBe('Draft, Cancelled');
    expect(describeFilter(range, { min: '10' }, 'ja')).toBe('≥ 10');
  });
});

describe('list-workbench AC-3: ?status=&from=&to= link contract', () => {
  it('AC-3: the close-guide link filters drafts by the business date', () => {
    const search = parseListSearch({ status: 'draft', from: '2026-10-01', to: '2026-10-31' });
    expect(search).toEqual({ status: 'draft', from: '2026-10-01', to: '2026-10-31' });
    const filters = effectiveFilters(search, invoice, defs);
    expect(filters).toEqual({ docstatus: [0], date: { from: '2026-10-01', to: '2026-10-31' } });
    expect(filtersToDomain(filters, defs)).toEqual({
      docstatus: { $in: [0] },
      date: { $gte: '2026-10-01', $lte: '2026-10-31' },
    });
  });

  it('AC-3: several states, one-sided dates, and invalid words or dates are ignored', () => {
    expect(linkFilters({ status: 'submitted,cancelled' }, invoice, defs)).toEqual({ docstatus: [1, 2] });
    expect(linkFilters({ from: '2026-10-01' }, invoice, defs)).toEqual({ date: { from: '2026-10-01' } });
    expect(linkFilters({ status: 'draft,bogus', from: '2026-13-01' }, invoice, defs)).toEqual({});
    // An entity has no document state; its business date is the first of date/postingDate/documentDate/transactionDate.
    const partnerDefs = filterDefs(partner);
    expect(linkFilters({ status: 'draft', to: '2026-10-31' }, partner, partnerDefs)).toEqual({
      postingDate: { to: '2026-10-31' },
    });
  });

  it('AC-3: link parameters win over a stale f value until the next change', () => {
    const filters = effectiveFilters({ f: { docstatus: [1], status: ['open'] }, status: 'draft' }, invoice, defs);
    expect(filters).toEqual({ docstatus: [0], status: ['open'] });
  });
});
