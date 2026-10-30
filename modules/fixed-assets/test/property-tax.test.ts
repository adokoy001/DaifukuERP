// 償却資産申告の集計 (docs/specs/fixed-assets.md AC-22; golden PT1).
import { Decimal } from '@daifuku/kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { propertyTaxRows, UNSET_MUNICIPALITY, type PropertyTaxAsset } from '../src/index.ts';

const D = (v: number) => Decimal.from(String(v));
const ORDER = ['structure', 'machinery', 'vessel', 'aircraft', 'vehicle', 'tools'];

describe('property tax aggregate (AC-22)', () => {
  it('AC-22 golden PT1: 渋谷区 machinery acquired last year, tools held with one decrease; excluded and later assets out', () => {
    const assets: PropertyTaxAsset[] = [
      {
        municipality: '渋谷区',
        propertyTaxClass: 'tools',
        acquisitionDate: '2025-05-01',
        disposedOn: null,
        cost: D(500_000),
      },
      {
        municipality: '渋谷区',
        propertyTaxClass: 'machinery',
        acquisitionDate: '2026-06-01',
        disposedOn: null,
        cost: D(1_200_000),
      },
      {
        municipality: '渋谷区',
        propertyTaxClass: 'tools',
        acquisitionDate: '2024-01-10',
        disposedOn: '2026-09-30',
        cost: D(300_000),
      },
      {
        municipality: '渋谷区',
        propertyTaxClass: 'excluded',
        acquisitionDate: '2024-01-10',
        disposedOn: null,
        cost: D(2_000_000),
      },
      {
        municipality: '渋谷区',
        propertyTaxClass: 'tools',
        acquisitionDate: '2027-02-01',
        disposedOn: null,
        cost: D(90_000),
      },
    ];
    const rows = propertyTaxRows(assets, '2026-01-01', '2027-01-01', ORDER);
    expect(
      rows.map((r) => [
        r.municipality,
        r.propertyTaxClass,
        r.priorCost.toString(),
        r.priorCount,
        r.decreaseCost.toString(),
        r.increaseCost.toString(),
        r.totalCost.toString(),
        r.totalCount,
      ]),
    ).toEqual([
      ['渋谷区', 'machinery', '0', 0, '0', '1200000', '1200000', 1],
      ['渋谷区', 'tools', '800000', 2, '300000', '0', '500000', 1],
    ]);
  });

  it('AC-22: an empty municipality is grouped as （未設定） after named ones', () => {
    const rows = propertyTaxRows(
      [
        { municipality: null, propertyTaxClass: 'tools', acquisitionDate: '2020-01-01', disposedOn: null, cost: D(1) },
        {
          municipality: '港区',
          propertyTaxClass: 'tools',
          acquisitionDate: '2020-01-01',
          disposedOn: null,
          cost: D(1),
        },
      ],
      '2026-01-01',
      '2027-01-01',
      ORDER,
    );
    expect(rows.map((r) => r.municipality)).toEqual(['港区', UNSET_MUNICIPALITY]);
  });

  it('AC-22: 計 = 前年前 − 減少 + 取得 for any assets', () => {
    const day = fc.integer({ min: 0, max: 1500 }).map((n) => {
      const d = new Date(Date.UTC(2024, 0, 1 + n));
      return d.toISOString().slice(0, 10);
    });
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            m: fc.constantFrom('A', 'B', null),
            c: fc.constantFrom(...ORDER, 'excluded'),
            acq: day,
            disp: fc.option(day),
            cost: fc.integer({ min: 1, max: 10_000_000 }),
          }),
        ),
        (xs) => {
          const assets = xs.map((x) => ({
            municipality: x.m,
            propertyTaxClass: x.c,
            acquisitionDate: x.acq,
            disposedOn: x.disp && x.disp >= x.acq ? x.disp : null,
            cost: D(x.cost),
          }));
          for (const r of propertyTaxRows(assets, '2026-01-01', '2027-01-01', ORDER)) {
            expect(r.totalCost.toString()).toBe(r.priorCost.minus(r.decreaseCost).plus(r.increaseCost).toString());
            expect(r.totalCount).toBe(r.priorCount - r.decreaseCount + r.increaseCount);
          }
        },
      ),
    );
  });
});
