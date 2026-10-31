// document-links AC-5/AC-6: quick actions — "the next document" offered on a submitted record. Declared here (not
// inferred); each opens the target's new-record page with initial values through a draft seed (lib/duplicate.ts).
// An action shows only when its target entity, the fields it fills and its line entity are in /meta for the caller's
// company and the caller may create the target. Pure (quick-actions.test.ts).
import type { EntityMeta, Label, RecordJson } from '../api/types.ts';
import { compareDecimalStrings } from './decimal.ts';
import { SEED_KIND, seedKey, type DraftSeed } from './duplicate.ts';

export interface QuickActionSeedValues {
  values: Record<string, unknown>;
  lines: Record<string, Record<string, unknown>[]>;
}

export interface QuickActionDef {
  /** `<source>.<verb>`; also the test id suffix. */
  id: string;
  /** Entity whose records show the action. */
  source: string;
  /** Entity whose new-record page opens. */
  target: string;
  label: Label;
  /** Header fields of the target the seed fills, and its line entities: all must be in /meta. */
  fills: { fields: readonly string[]; lines: readonly string[] };
  /** Whether the action applies to this record (state, balance). */
  applies: (record: RecordJson) => boolean;
  build: (record: RecordJson, today: string) => QuickActionSeedValues;
}

function positive(v: unknown): boolean {
  return typeof v === 'string' && compareDecimalStrings(v, '0') === 1;
}

/** Record a receipt/payment for a submitted invoice: direction, partner, outstanding amount and one allocation line. */
function settlement(
  direction: 'receive' | 'pay',
  invoiceEntity: string,
): Pick<QuickActionDef, 'fills' | 'applies' | 'build'> {
  return {
    fills: { fields: ['direction', 'partnerId', 'date', 'amount'], lines: ['payment_allocation'] },
    applies: (record) => record.docstatus === 1 && positive(record.balance),
    build: (record, today) => ({
      values: { direction, partnerId: record.partnerId, date: today, amount: record.balance },
      lines: { payment_allocation: [{ invoiceEntity, invoiceId: record.id, amount: record.balance }] },
    }),
  };
}

export const QUICK_ACTIONS: readonly QuickActionDef[] = [
  {
    id: 'sales_invoice.record_receipt',
    source: 'sales_invoice',
    target: 'payment',
    label: { ja: '入金を記録', en: 'Record receipt' },
    ...settlement('receive', 'sales_invoice'),
  },
  {
    id: 'purchase_invoice.record_payment',
    source: 'purchase_invoice',
    target: 'payment',
    label: { ja: '支払を記録', en: 'Record payment' },
    ...settlement('pay', 'purchase_invoice'),
  },
];

/** AC-6: the target, the fields it fills and its line entities are in /meta, and the caller may create the target. */
export function quickActionAvailable(action: QuickActionDef, entities: readonly EntityMeta[]): boolean {
  const target = entities.find((e) => e.name === action.target);
  if (!target?.ops.includes('create')) return false;
  const fields = new Set(target.fields.map((f) => f.name));
  const lines = new Set((target.lines ?? []).map((l) => l.entity));
  return (
    action.fills.fields.every((f) => fields.has(f)) &&
    action.fills.lines.every((l) => lines.has(l) && entities.some((e) => e.name === l))
  );
}

/** AC-5/AC-6: the quick actions to show on `record` of `entity`. */
export function quickActionsFor(
  entity: EntityMeta,
  record: RecordJson,
  entities: readonly EntityMeta[],
  actions: readonly QuickActionDef[] = QUICK_ACTIONS,
): QuickActionDef[] {
  return actions.filter((a) => a.source === entity.name && a.applies(record) && quickActionAvailable(a, entities));
}

/** The draft seed a quick action hands to the target's new-record page. */
export function quickActionSeed(action: QuickActionDef, record: RecordJson, today: string, title: string): DraftSeed {
  const { values, lines } = action.build(record, today);
  return {
    kind: SEED_KIND,
    key: seedKey(),
    entity: action.target,
    values,
    ext: {},
    lines,
    source: {
      mode: 'quick',
      entity: action.source,
      id: record.id,
      title,
      date: typeof record.date === 'string' ? record.date : null,
      action: action.id,
    },
  };
}
