import { Decimal, StateError, ValidationError } from '@daifuku/kernel';
import type { CompanySource, GroupMapping, GroupAdjustment, GroupResult } from './contract.ts';
/** No standalone ledger mutation: group values are a separate debit-positive worksheet. */
export function consolidate(
  sources: CompanySource[],
  mapping: GroupMapping[],
  adjustments: GroupAdjustment[],
): GroupResult {
  const map = new Map<string, GroupMapping>(),
    groups = new Map<
      string,
      { name: string; type: string; standalone: Decimal; elimination: Decimal; adjustment: Decimal }
    >();
  for (const item of mapping) {
    const key = item.companyId + ':' + item.accountId;
    if (map.has(key))
      throw new ValidationError('Duplicate account mapping', [], 'Map each source account exactly once.');
    map.set(key, item);
    const prior = groups.get(item.groupCode);
    if (prior && (prior.name !== item.groupName || prior.type !== item.groupType))
      throw new ValidationError('Inconsistent group account definition', [], 'Use one name/type for each group code.');
    if (!prior)
      groups.set(item.groupCode, {
        name: item.groupName,
        type: item.groupType,
        standalone: Decimal.zero(),
        elimination: Decimal.zero(),
        adjustment: Decimal.zero(),
      });
  }
  const used = new Set<string>();
  for (const source of sources)
    for (const row of source.rows) {
      const key = source.companyId + ':' + row.accountId,
        item = map.get(key);
      if (!item)
        throw new StateError(
          'Source account is not mapped',
          'Complete every source account mapping before preparing a worksheet.',
        );
      used.add(key);
      const target = groups.get(item.groupCode);
      if (!target) throw new StateError('Mapped group is missing', 'Rebuild the mapping.');
      target.standalone = target.standalone.plus(row.closingBalance);
    }
  if (used.size !== map.size)
    throw new ValidationError(
      'Mapping contains accounts outside the selected sources',
      [],
      'Remove stale or foreign mappings.',
    );
  const keys = new Set<string>();
  for (const adjustment of adjustments) {
    if (keys.has(adjustment.key))
      throw new ValidationError(
        'Duplicate adjustment key',
        [],
        'Each elimination or adjustment needs a unique reference.',
      );
    keys.add(adjustment.key);
    let debit = Decimal.zero(),
      credit = Decimal.zero();
    for (const line of adjustment.lines) {
      const target = groups.get(line.groupCode),
        d = Decimal.from(line.debit),
        c = Decimal.from(line.credit);
      if (
        !target ||
        d.isNegative() ||
        c.isNegative() ||
        d.gt('0') === c.gt('0') ||
        !d.roundDown(0).eq(d) ||
        !c.roundDown(0).eq(c)
      )
        throw new ValidationError(
          'Invalid adjustment line',
          [],
          'Use a mapped group account and one nonnegative integer JPY debit or credit.',
        );
      debit = debit.plus(d);
      credit = credit.plus(c);
      target[adjustment.kind] = target[adjustment.kind].plus(d).minus(c);
    }
    if (!debit.eq(credit))
      throw new ValidationError(
        'Adjustment is not balanced',
        [],
        'Debit and credit must balance for each adjustment reference.',
      );
  }
  const rows = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, row]) => {
      const consolidated = row.standalone.plus(row.elimination).plus(row.adjustment);
      return {
        code,
        name: row.name,
        type: row.type,
        standalone: row.standalone.toString(),
        elimination: row.elimination.toString(),
        adjustment: row.adjustment.toString(),
        consolidated: consolidated.toString(),
        debit: consolidated.isNegative() ? '0' : consolidated.toString(),
        credit: consolidated.isNegative() ? consolidated.neg().toString() : '0',
      };
    });
  const debit = Decimal.sum(rows.map((r) => Decimal.from(r.debit))),
    credit = Decimal.sum(rows.map((r) => Decimal.from(r.credit)));
  if (!debit.eq(credit))
    throw new StateError('Consolidation is not balanced', 'Check complete standalone sources and adjustments.');
  return { rows, debit: debit.toString(), credit: credit.toString(), balanced: true };
}
