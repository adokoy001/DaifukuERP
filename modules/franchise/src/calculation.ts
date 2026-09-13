import { Decimal, StateError, type LocalDate } from '@daifuku/kernel';
import type { FranchiseContractSnapshot } from './contract.ts';
export function monthBounds(month: string) {
  const first = `${month}-01` as LocalDate;
  const end = new Date(`${first}T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return { from: first, to: end.toISOString().slice(0, 10) as LocalDate };
}
export function royalty(contract: FranchiseContractSnapshot, month: string, gross: string, net: string) {
  const period = monthBounds(month);
  if (period.from < contract.startDate || period.to > contract.endDate)
    throw new StateError(
      'FC精算月全体が契約期間内である必要があります。',
      '月途中の開始・終了は初版の自動精算対象外です。',
    );
  const grossAmount = Decimal.from(gross);
  const netAmount = Decimal.from(net);
  if (grossAmount.lt(netAmount) || netAmount.lt(0))
    throw new StateError(
      '税込売上は税抜売上以上にしてください。',
      '確定した売上資料の税込・税抜額を入力してください。',
    );
  const amount = (contract.basis === 'gross' ? grossAmount : netAmount).times(contract.rate).plus(contract.fixedAmount);
  return amount.round(contract.rounding, 0);
}
