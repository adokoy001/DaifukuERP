import {
  authorizedCompanies,
  Decimal,
  repo,
  StateError,
  withAuthorizedCompany,
  withLock,
  todayLocal,
  type Context,
  type EntityDef,
  type Infer,
  type ListQuery,
} from '@daifuku/kernel';
import { Account, JournalLine, FiscalPeriod, movementsByAccount, trialBalanceRows } from '@daifuku/mod-accounting';
import type { CompanySource } from './contract.ts';
export async function allRows<E extends EntityDef>(
  ctx: Context,
  entity: E,
  query: Omit<ListQuery, 'limit' | 'offset'> = {},
  max = 10000,
): Promise<Infer<E>[]> {
  const items: Infer<E>[] = [];
  for (;;) {
    const page = await repo(ctx, entity).list({ ...query, limit: 500, offset: items.length });
    if (page.total > max)
      throw new StateError(
        'Consolidation source exceeds the reviewed limit',
        'Split or archive sources before continuing; partial totals are not produced.',
      );
    items.push(...page.items);
    if (items.length >= page.total || !page.items.length) return items;
  }
}
export async function collectSources(
  ctx: Context,
  input: { companyIds: string[]; from: string; to: string },
  requireClosed = false,
): Promise<CompanySource[]> {
  if (input.from > input.to || new Set(input.companyIds).size !== input.companyIds.length)
    throw new StateError('Invalid consolidation period or companies', 'Use an ordered period and unique company IDs.');
  if (requireClosed && input.to > todayLocal(ctx.now()))
    throw new StateError('Consolidation period has not ended', 'Confirm only a completed period.');
  const available = await authorizedCompanies(ctx),
    result: CompanySource[] = [];
  for (const companyId of [...input.companyIds].sort()) {
    const company = available.find((row) => row.id === companyId);
    if (!company || company.currency !== 'JPY')
      throw new StateError(
        'Company is unavailable or uses another currency',
        'Select currently authorized JPY companies only.',
      );
    await withAuthorizedCompany(ctx, companyId, async (child) => {
      await withLock(child, 'accounting-periods', async () => undefined);
      const periods = await allRows(
        child,
        FiscalPeriod,
        { where: { startDate: { $lte: input.to } }, orderBy: [{ field: 'startDate', dir: 'asc' }] },
        240,
      );
      const inRange = periods.filter((row) => row.endDate >= input.from);
      if (inRange[0]?.startDate !== input.from || inRange.at(-1)?.endDate !== input.to)
        throw new StateError(
          'Consolidation must cover complete fiscal periods',
          'Use the same full-period boundaries in every company.',
        );
      for (let index = 1; index < inRange.length; index++) {
        const current = inRange[index],
          previous = inRange[index - 1];
        if (
          current &&
          previous &&
          new Date(current.startDate).getTime() - new Date(previous.endDate).getTime() !== 86400000
        )
          throw new StateError('Fiscal period gap', 'Complete missing fiscal periods before consolidation.');
      }
      const closed = periods.every((row) => row.isClosed);
      if (requireClosed && !closed)
        throw new StateError(
          'Standalone periods must be closed',
          'Close all periods contributing to opening and closing balances, then refresh the worksheet.',
        );
      const accounts = await allRows(child, Account, { orderBy: [{ field: 'code', dir: 'asc' }] }, 2000);
      const lines = await allRows(
        child,
        JournalLine,
        { where: { posted: true, entryDate: { $lte: input.to } }, orderBy: [{ field: 'id', dir: 'asc' }] },
        20000,
      );
      const opening = await movementsByAccount(child, { entryDate: { $lt: input.from } }),
        movement = await movementsByAccount(child, { entryDate: { $gte: input.from, $lte: input.to } });
      const calculated = trialBalanceRows(accounts, opening, movement);
      if (!Decimal.from(calculated.totals.closingBalance ?? '1').isZero())
        throw new StateError(
          'Standalone source is not balanced',
          'Resolve the standalone trial balance before consolidation.',
        );
      const revision = JSON.stringify({
        accounts: accounts.map((row) => [row.id, row.version]),
        periods: periods.map((row) => [row.id, row.version]),
        lines: lines.map((row) => [row.id, row.version]),
      });
      result.push({
        companyId,
        code: company.code,
        name: company.name,
        currency: 'JPY',
        closed,
        revision,
        rows: calculated.rows,
      });
    });
  }
  return result;
}
