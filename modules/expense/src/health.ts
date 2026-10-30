// Setup health check of the expense module (spec AC-19, docs/specs/setup-health.md): the accounts a settlement posts to
// exist — expense.accounts (仮払金, 未払金, default expense) and the input-tax account of purchase.accounts.
import { label, type HealthCheckDef } from '@daifuku/kernel';
import { checkExpenseAccounts, EXPENSE_ACCOUNTS_KEY } from './settings.ts';

export const EXPENSE_ACCOUNTS_HREF = '/settings?tab=accounting';
export const PURCHASE_ACCOUNTS_HREF = '/settings?tab=purchase';

export const expenseAccountsHealthCheck: HealthCheckDef = {
  id: 'expense.accounts',
  label: label('経費精算の勘定科目', 'Expense settlement accounts'),
  order: 55,
  run: async (ctx) => {
    const { missing } = await checkExpenseAccounts(ctx);
    if (missing.length > 0) {
      const codes = missing.map((m) => `${m.code}（${m.setting}.${m.role}）`).join('、');
      const codesEn = missing.map((m) => `${m.code} (${m.setting}.${m.role})`).join(', ');
      return {
        status: 'warn',
        detail: label(
          `勘定科目 ${codes} がありません。経費精算書・仮払を確定できません。`,
          `Account(s) ${codesEn} do not exist. Expense settlements and advances cannot be submitted.`,
        ),
        href: missing.some((m) => m.setting === EXPENSE_ACCOUNTS_KEY) ? EXPENSE_ACCOUNTS_HREF : PURCHASE_ACCOUNTS_HREF,
      };
    }
    return {
      status: 'ok',
      detail: label('経費精算の勘定科目がそろっています。', 'Every expense settlement account exists.'),
      href: EXPENSE_ACCOUNTS_HREF,
    };
  },
};
