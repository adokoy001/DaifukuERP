// No-gap document numbering (ADR-0006). One UPSERT with RETURNING takes a row lock, so concurrent
// submits for the same key serialise; a rolled-back transaction releases the number unused only
// if it was the last one — which is exactly why numbers are assigned at submit, not at draft.
import { sql } from 'drizzle-orm';
import type { Context } from './context.ts';
import { sequences } from './db/system-tables.ts';
import type { Naming } from './dsl/types.ts';
import { StateError } from './errors.ts';

export interface NumberingInput {
  naming: Naming;
  /** Business date used for period resets (YYYY-MM-DD). */
  date: string;
  entityName: string;
}

export async function nextNumber(ctx: Context, input: NumberingInput): Promise<string> {
  const { naming } = input;
  if (naming.type === 'field') throw new StateError('field-based naming has no sequence', 'Set the field value before submit.');
  const scope = naming.scope ?? 'company';
  const companyId = scope === 'company' ? ctx.companyId : null;
  if (scope === 'company' && !companyId) throw new StateError('company-scoped numbering requires a company context', 'Provide companyId in the context.');
  const key = naming.key ?? input.entityName;
  const period = naming.period === 'year' ? input.date.slice(0, 4) : '';
  const width = naming.width ?? 6;
  const companyKey = companyId ?? '00000000-0000-0000-0000-000000000000';

  const rows = await ctx.db
    .insert(sequences)
    .values({ tenantId: ctx.tenantId, companyId: companyKey, key, period, nextValue: 2 })
    .onConflictDoUpdate({
      target: [sequences.tenantId, sequences.companyId, sequences.key, sequences.period],
      set: { nextValue: sql`${sequences.nextValue} + 1` },
    })
    .returning({ nextValue: sequences.nextValue });
  const next = rows[0]?.nextValue;
  if (next === undefined) throw new StateError('sequence upsert returned no row', 'This is a bug in numbering.');
  const value = next - 1;
  const periodPart = period ? `${period}-` : '';
  return `${naming.prefix}${periodPart}${String(value).padStart(width, '0')}`;
}
