// 月次締めの記録 (docs/specs/pack-retail.md AC-7): one row per closed month, written only by retail.close_month (the guard in
// actions/close-month.ts refuses the generic create/update/delete). It makes the action idempotent per period and holds the
// closing amount the next month transfers back (期首商品棚卸高, 三分法).
import { defineEntity, f, label } from '@daifuku/kernel';
import { JournalEntry } from '@daifuku/mod-accounting';

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const RetailMonthClose = defineEntity({
  name: 'retail_month_close',
  label: label('月次締め', 'Month close'),
  fields: {
    period: f.text({ serverOwned: true, label: label('対象月', 'Period'), description: label('YYYY-MM', 'YYYY-MM'), required: true, unique: true, immutable: true, maxLength: 7, pattern: PERIOD_RE }),
    asOf: f.date({ serverOwned: true, label: label('評価日', 'Valuation date'), description: label('月末日', 'last day of the month'), required: true }),
    valuationTotal: f.money({ serverOwned: true, label: label('期末商品棚卸高', 'Closing inventory'), description: label('inventory.valuation の合計（移動平均）', 'inventory.valuation total (moving average)'), required: true }),
    openingAmount: f.money({ serverOwned: true, label: label('期首商品棚卸高', 'Opening inventory'), description: label('前回の締めの期末商品棚卸高（無ければ 0）', 'closing amount of the previous close (0 when none)'), required: true, default: '0' }),
    journalEntryId: f.ref(JournalEntry.name, { serverOwned: true, label: label('仕訳', 'Journal entry'), description: label('金額が 0 のときは作らない', 'none when both amounts are 0') }),
  },
  permissions: {
    roles: {
      accounting: ['read', 'create', 'update'],
      viewer: ['read'],
    },
  },
  views: { list: ['period', 'asOf', 'openingAmount', 'valuationTotal', 'journalEntryId'], search: ['period'] },
});

export type RetailMonthCloseDef = typeof RetailMonthClose;
