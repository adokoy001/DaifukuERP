// Company setting owned by the expense module (spec AC-19, D13): the account codes a settlement posts to. The input-tax
// account is purchase's `purchase.accounts.taxReceivable` (read alone through loadPurchaseAccountCodes, so a company
// without 仕入高/買掛金 can still settle expenses). The Japanese chart (l10n/jp) seeds every default code.
import { getSetting, label, repo, StateError, type Context, type SettingDef } from '@daifuku/kernel';
import { Account } from '@daifuku/mod-accounting';
import { loadPurchaseAccountCodes, PURCHASE_ACCOUNTS_KEY } from '@daifuku/mod-purchase';
import { z } from 'zod';

export const EXPENSE_ACCOUNTS_KEY = 'expense.accounts';

const code = z.string().min(1).max(20);
export const expenseAccountsSchema = z.object({
  /** 仮払金: credited when an advance is cleared, debited by the advance payout. */
  advance: code,
  /** 未払金: credited by a reimbursement / corporate-card settlement, debited by its payout. */
  payable: code,
  /** Default expense account of a new settlement line. */
  defaultExpense: code,
});
export type ExpenseAccountCodes = z.output<typeof expenseAccountsSchema>;
export const EXPENSE_ACCOUNTS_DEFAULT: ExpenseAccountCodes = {
  advance: '1800',
  payable: '2150',
  defaultExpense: '6900',
};

export const EXPENSE_SETTING_DEFS: readonly SettingDef[] = [
  {
    key: EXPENSE_ACCOUNTS_KEY,
    category: 'accounting',
    label: label('経費精算の勘定科目', 'Expense settlement accounts'),
    description: label(
      '経費精算書と仮払の仕訳に使う勘定科目。仮払消費税は仕入の転記科目の設定を使います',
      'Accounts expense settlements and advances post to. Input tax uses the purchase posting accounts setting',
    ),
    schema: expenseAccountsSchema,
    default: EXPENSE_ACCOUNTS_DEFAULT,
    order: 20,
    fields: {
      advance: {
        label: label('仮払金', 'Advances to employees'),
        description: label('仮払の支払と精算での消込', 'Advance payouts and their clearing'),
        widget: 'account-code',
      },
      payable: {
        label: label('未払金', 'Accrued payables'),
        description: label('立替・法人カードの精算額', 'Reimbursement and corporate-card settlements'),
        widget: 'account-code',
      },
      defaultExpense: {
        label: label('既定の費用科目', 'Default expense account'),
        description: label('精算明細の初期値（明細で変更できます）', 'Initial account of a settlement line'),
        widget: 'account-code',
      },
    },
  },
];

export async function loadExpenseAccountCodes(ctx: Context): Promise<ExpenseAccountCodes> {
  return getSetting(ctx, EXPENSE_ACCOUNTS_KEY, expenseAccountsSchema, EXPENSE_ACCOUNTS_DEFAULT);
}

export interface ExpenseAccounts {
  advance: string;
  payable: string;
  defaultExpense: string;
  taxReceivable: string;
}

export interface AccountCodeCheck {
  codes: ExpenseAccountCodes & { taxReceivable: string };
  ids: Map<string, string>;
  missing: { role: keyof ExpenseAccounts; code: string; setting: string }[];
}

/** The four codes and which of them have no account in this company (shared with the health check). */
export async function checkExpenseAccounts(ctx: Context): Promise<AccountCodeCheck> {
  const own = await loadExpenseAccountCodes(ctx);
  const codes = { ...own, taxReceivable: (await loadPurchaseAccountCodes(ctx)).taxReceivable };
  const wanted = [...new Set(Object.values(codes))];
  const found = await repo(ctx, Account).list({ where: { code: { $in: wanted } }, limit: wanted.length });
  const ids = new Map(found.items.map((a) => [a.code, a.id]));
  const roles = ['advance', 'payable', 'defaultExpense', 'taxReceivable'] as const;
  const missing = roles
    .filter((role) => !ids.has(codes[role]))
    .map((role) => ({
      role,
      code: codes[role],
      setting: role === 'taxReceivable' ? PURCHASE_ACCOUNTS_KEY : EXPENSE_ACCOUNTS_KEY,
    }));
  return { codes, ids, missing };
}

/** Account ids for posting; INVALID_STATE naming every missing code and its setting (AC-19). */
export async function resolveExpenseAccounts(ctx: Context): Promise<ExpenseAccounts> {
  const { codes, ids, missing } = await checkExpenseAccounts(ctx);
  if (missing.length > 0)
    throw new StateError(
      `account code(s) ${missing.map((m) => `${m.code} (${m.setting}.${m.role})`).join(', ')} do not exist`,
      `Create the accounts or change ${EXPENSE_ACCOUNTS_KEY} / ${PURCHASE_ACCOUNTS_KEY}.`,
      { missing: missing.map((m) => ({ setting: m.setting, role: m.role, code: m.code })) },
    );
  const id = (role: keyof ExpenseAccounts) => ids.get(codes[role]) ?? '';
  return {
    advance: id('advance'),
    payable: id('payable'),
    defaultExpense: id('defaultExpense'),
    taxReceivable: id('taxReceivable'),
  };
}
