import { describe, expect, it } from 'vitest';
import {
  cellKey,
  MAX_PIVOT_ROWS,
  pivot,
  PivotError,
  PIVOT_ROOT_KEY,
  validatePivotConfig,
  visibleNodes,
  type PivotConfig,
  type PivotOperation,
  type PivotResult,
} from './pivot.ts';

function configuration(op: PivotOperation = 'sum'): PivotConfig {
  return { rows: [{ field: 'site' }], columns: [], measures: [{ field: 'amount', op }] };
}
function at(result: PivotResult, row: (string | null)[] = [], column: (string | null)[] = []) {
  return result.cells[cellKey(JSON.stringify(row), JSON.stringify(column))];
}
function fails(code: string, work: () => unknown) {
  try {
    work();
    throw new Error('Expected a pivot error');
  } catch (error) {
    expect(error).toBeInstanceOf(PivotError);
    expect((error as PivotError).code).toBe(code);
  }
}
describe('exact browser pivot aggregation', () => {
  it('sums above MAX_SAFE_INTEGER without converting money to Number', () => {
    const result = pivot(
      [
        { site: '東京', amount: '9007199254740993.01' },
        { site: '東京', amount: '0.09' },
        { site: '大阪', amount: '-0.1' },
      ],
      configuration(),
    );
    expect(at(result, ['東京'])).toEqual(['9007199254740993.1']);
    expect(at(result)).toEqual(['9007199254740993']);
    expect(result.rowCount).toBe(3);
  });
  it('calculates weighted means from raw observations at every row and column subtotal', () => {
    const config: PivotConfig = {
      rows: [{ field: 'region' }, { field: 'site' }],
      columns: [
        { field: 'date', grain: 'year' },
        { field: 'date', grain: 'month' },
      ],
      measures: [
        { field: 'amount', op: 'avg' },
        { field: 'amount', op: 'sum' },
        { field: 'amount', op: 'count' },
      ],
    };
    const result = pivot(
      [
        { region: '東', site: 'A', date: '2025-12-31', amount: '10' },
        { region: '東', site: 'B', date: '2026-01-01', amount: '30' },
        { region: '東', site: 'B', date: '2026-01-02', amount: '30' },
        { region: '東', site: 'B', date: '2026-01-03', amount: '30' },
        { region: '西', site: 'C', date: '2026-01-01', amount: null },
      ],
      config,
    );
    expect(at(result)).toEqual(['25', '100', '4']);
    expect(at(result, ['東'])).toEqual(['25', '100', '4']);
    expect(at(result, ['東', 'B'])).toEqual(['30', '90', '3']);
    expect(at(result, [], ['2026'])).toEqual(['30', '90', '3']);
    expect(at(result, ['東'], ['2026', '2026-01'])).toEqual(['30', '90', '3']);
    expect(at(result, ['西'], ['2026'])).toEqual([null, null, '0']);
    expect(at(result, ['西'], ['2025'])).toBeUndefined();
  });
  it('rounds repeating averages deterministically, preserving fine decimal input', () => {
    expect(at(pivot([{ amount: '1' }, { amount: '0' }, { amount: '0' }], configuration('avg')))).toEqual(['0.333333']);
    expect(at(pivot([{ amount: '-1' }, { amount: '0' }, { amount: '0' }], configuration('avg')))).toEqual([
      '-0.333333',
    ]);
    expect(at(pivot([{ amount: '0.000001' }, { amount: '0' }], configuration('avg')))).toEqual(['0.000001']);
    expect(at(pivot([{ amount: '-0.000001' }, { amount: '0' }], configuration('avg')))).toEqual(['-0.000001']);
    expect(at(pivot([{ amount: '0.0000000001' }, { amount: '0.0000000003' }], configuration('avg')))).toEqual([
      '0.0000000002',
    ]);
  });
  it('distinguishes absent values from zero, valid value count, and record count', () => {
    const rows = [
      { amount: null },
      {},
      { amount: '' },
      { amount: '   ' },
      { amount: '0' },
      { amount: '-0.0' },
      { amount: '-1' },
    ];
    const result = pivot(rows, {
      rows: [],
      columns: [],
      measures: [
        { field: 'amount', op: 'sum' },
        { field: 'amount', op: 'count' },
        { field: 'amount', op: 'rows' },
      ],
    });
    expect(at(result)).toEqual(['-1', '3', '7']);
    expect(at(pivot([{ amount: null }, {}], configuration('sum')))).toEqual([null]);
    expect(at(pivot([{ amount: null }, {}], configuration('avg')))).toEqual([null]);
    expect(
      at(
        pivot([], {
          rows: [],
          columns: [],
          measures: [
            { field: 'amount', op: 'sum' },
            { field: 'amount', op: 'count' },
            { field: 'amount', op: 'rows' },
          ],
        }),
      ),
    ).toEqual([null, '0', '0']);
  });
  it('counts present scalars and finds exact min/max with negative and mixed scale values', () => {
    expect(
      at(pivot([{ amount: false }, { amount: 0 }, { amount: 'active' }, { amount: null }], configuration('count'))),
    ).toEqual(['3']);
    const result = pivot(
      [
        { amount: '-10.001' },
        { amount: '-10.01' },
        { amount: '9007199254740993' },
        { amount: '9007199254740992.99' },
        { amount: null },
      ],
      {
        ...configuration(),
        measures: [
          { field: 'amount', op: 'min' },
          { field: 'amount', op: 'max' },
        ],
      },
    );
    expect(at(result)).toEqual(['-10.01', '9007199254740993']);
    expect(at(pivot([{ amount: '+.1250' }, { amount: '-.025' }, { amount: 2 }], configuration()))).toEqual(['2.1']);
  });
});

describe('hierarchical axes', () => {
  it('has collision-proof paths/cells and separate missing and empty text buckets', () => {
    const config: PivotConfig = {
      rows: [{ field: 'a' }, { field: 'b' }],
      columns: [{ field: 'c' }],
      measures: [{ field: 'amount', op: 'rows' }],
    };
    const result = pivot(
      [
        { a: 'a|b', b: 'c', c: '[]' },
        { a: 'a', b: 'b|c', c: '[]' },
        { a: null, b: '', c: null },
        { b: '', c: null },
        { a: '', b: '', c: '' },
        { a: '__proto__', b: 'constructor', c: '["x"]' },
      ],
      config,
    );
    expect(at(result, ['a|b', 'c'], ['[]'])).toEqual(['1']);
    expect(at(result, ['a', 'b|c'], ['[]'])).toEqual(['1']);
    expect(at(result, [null, ''], [null])).toEqual(['2']);
    expect(at(result, ['', ''], [''])).toEqual(['1']);
    expect(at(result, ['__proto__', 'constructor'], ['["x"]'])).toEqual(['1']);
    expect(new Set(result.rowNodes.map((node) => node.key)).size).toBe(result.rowNodes.length);
    expect(result.rowNodes.find((node) => node.key === '[null]')?.label).toBe('(未設定)');
    expect(result.rowNodes.find((node) => node.key === '[""]')?.label).toBe('(空文字)');
  });
  it('orders siblings deterministically, nests descendants and supports independent expansion', () => {
    const config: PivotConfig = {
      rows: [{ field: 'site' }, { field: 'team' }],
      columns: [],
      measures: [{ field: 'amount', op: 'rows' }],
    };
    const rows = [
      { site: '店舗10', team: 'B' },
      { site: '店舗2', team: 'B' },
      { site: '店舗2', team: 'A' },
      { site: null, team: 'C' },
    ];
    const forward = pivot(rows, config);
    const backward = pivot([...rows].reverse(), config);
    expect(forward.rowNodes).toEqual(backward.rowNodes);
    expect(forward.rowNodes[0]?.children).toEqual(['["店舗2"]', '["店舗10"]', '[null]']);
    expect(visibleNodes(forward.rowNodes, new Set()).map((node) => node.key)).toEqual([
      PIVOT_ROOT_KEY,
      '["店舗2"]',
      '["店舗10"]',
      '[null]',
    ]);
    expect(visibleNodes(forward.rowNodes, new Set(['["店舗2"]'])).map((node) => node.path)).toEqual([
      [],
      ['店舗2'],
      ['店舗2', 'A'],
      ['店舗2', 'B'],
      ['店舗10'],
      [null],
    ]);
    expect(forward.rowNodes.find((node) => node.key === '["店舗2","A"]')).toMatchObject({
      depth: 2,
      parent: '["店舗2"]',
      children: [],
    });
  });
  it('groups calendar dates across years and quarters without browser timezone shifts', () => {
    const config: PivotConfig = {
      rows: [
        { field: 'date', grain: 'year' },
        { field: 'date', grain: 'quarter' },
        { field: 'date', grain: 'month' },
      ],
      columns: [{ field: 'date', grain: 'day' }],
      measures: [{ field: 'amount', op: 'rows' }],
    };
    const result = pivot(
      [
        { date: '2024-02-29' },
        { date: '2024-03-31T23:30:00-12:00' },
        { date: '2024-04-01' },
        { date: '2025-02-28' },
        { date: null },
      ],
      config,
    );
    expect(at(result, ['2024'])).toEqual(['3']);
    expect(at(result, ['2024', '2024-Q1'])).toEqual(['2']);
    expect(at(result, ['2024', '2024-Q1', '2024-03'], ['2024-03-31'])).toEqual(['1']);
    expect(at(result, ['2025', '2025-Q1', '2025-02'])).toEqual(['1']);
    expect(at(result, [null, null, null], [null])).toEqual(['1']);
  });
  it('does not read inherited row fields', () => {
    const row = Object.create({ amount: '100', site: '隠れた値' }) as Record<string, unknown>;
    expect(at(pivot([row], configuration()))).toEqual([null]);
  });
});

describe('snapshot and computation safeguards', () => {
  it.each([
    '2025-02-29',
    '2024-02-30',
    '2026-13-01',
    '2026-00-01',
    '2026-01-00',
    '0000-01-01',
    '2026/01/01',
    '2026-1-1',
    'not-a-date',
    '2026-01-01T25:00:00Z',
    '2026-01-01T24:00:00Z',
  ])('rejects invalid calendar value %s without making a partial result', (date) => {
    fails('invalid_date', () =>
      pivot([{ date }], {
        rows: [{ field: 'date', grain: 'month' }],
        columns: [],
        measures: [{ field: 'amount', op: 'rows' }],
      }),
    );
  });
  it.each([
    'oops',
    '1e3',
    '1,000',
    '9'.repeat(129),
    `0.${'1'.repeat(31)}`,
    Number.MAX_SAFE_INTEGER + 1,
    0.1,
    Infinity,
    NaN,
    true,
    {},
  ])('rejects unsafe or malformed numeric observation %s', (amount) => {
    fails('invalid_value', () => pivot([{ amount }], configuration()));
  });
  it('validates dimensions, grains, measures and repeated levels at runtime', () => {
    for (const config of [
      { ...configuration(), rows: Array.from({ length: 4 }, (_, i) => ({ field: `a${i}` })) },
      { ...configuration(), columns: Array.from({ length: 4 }, (_, i) => ({ field: `a${i}` })) },
      { ...configuration(), measures: [] },
      { ...configuration(), measures: Array.from({ length: 4 }, () => ({ field: 'amount', op: 'sum' })) },
      { ...configuration(), rows: [{ field: 'date', grain: 'week' }] },
      { ...configuration(), rows: [{ field: 'site' }, { field: 'site', grain: 'value' }] },
      { ...configuration(), measures: [{ field: '', op: 'sum' }] },
      { ...configuration(), measures: [{ field: 'amount', op: 'median' }] },
      null,
    ])
      fails('invalid_config', () => validatePivotConfig(config as PivotConfig));
  });
  it('rejects oversized snapshots before reading the rows', () => {
    fails('row_limit', () => pivot(new Array<Record<string, unknown>>(MAX_PIVOT_ROWS + 1), configuration()));
  });
  it('bounds aggregate states including subtotal/metric combinations', () => {
    const rows = Array.from({ length: 12_000 }, (_, i) => ({ a: String(i), b: String(i), c: String(i), amount: '1' }));
    fails('cell_limit', () =>
      pivot(rows, {
        rows: [{ field: 'a' }, { field: 'b' }, { field: 'c' }],
        columns: [],
        measures: [
          { field: 'amount', op: 'sum' },
          { field: 'amount', op: 'avg' },
          { field: 'amount', op: 'rows' },
        ],
      }),
    );
  });
  it('stores only occupied combinations and required totals, not the dense axis product', () => {
    const rows = Array.from({ length: 1_000 }, (_, i) => ({ site: `店${i}`, date: `日${i}`, amount: '0.1' }));
    const result = pivot(rows, {
      rows: [{ field: 'site' }],
      columns: [{ field: 'date' }],
      measures: [{ field: 'amount', op: 'sum' }],
    });
    expect(result.cellCount).toBe(3_001);
    expect(at(result)).toEqual(['100']);
    expect(at(result, ['店0'], ['日999'])).toBeUndefined();
  });
  it('accepts 50,000 records while keeping totals and all descendants consistent', () => {
    const rows = Array.from({ length: MAX_PIVOT_ROWS }, (_, i) => ({
      region: `地域${i % 2}`,
      site: `店${i % 12}`,
      team: `部門${i % 3}`,
      date: `202${4 + (i % 2)}-${String((i % 12) + 1).padStart(2, '0')}-01`,
      amount: i % 2 ? '-0.01' : '0.02',
    }));
    const result = pivot(rows, {
      rows: [{ field: 'region' }, { field: 'site' }, { field: 'team' }],
      columns: [
        { field: 'date', grain: 'year' },
        { field: 'date', grain: 'quarter' },
        { field: 'date', grain: 'month' },
      ],
      measures: [
        { field: 'amount', op: 'sum' },
        { field: 'amount', op: 'avg' },
        { field: 'amount', op: 'rows' },
      ],
    });
    expect(at(result)).toEqual(['250', '0.005', '50000']);
    expect(result.rowCount).toBe(MAX_PIVOT_ROWS);
    expect(result.cellCount).toBeLessThan(500);
  });
});
