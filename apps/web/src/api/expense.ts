// Reads and commands of /finance/expenses (docs/specs/expense-settlement.md AC-20). Keys live under ['finance',
// identity] (api/finance.ts) so a draft invalidates the candidates and a company or user switch never reuses a result.
import { CANDIDATES_ACTION, parseCandidates, type SettlementCandidates } from '../lib/expense-settlement.ts';
import { useFinanceCommand, useFinanceRead } from './finance.ts';

export function useExpenseCandidates(enabled: boolean) {
  return useFinanceRead<SettlementCandidates>(CANDIDATES_ACTION, {}, enabled, parseCandidates);
}

/** expense.draft_settlement; resolves with the new draft's id and version. */
export function useDraftSettlement() {
  return useFinanceCommand<{ id: string; version: number }>();
}
