// Module manifest (docs/conventions/layers.md, spec D1). The dependency modules are imported first so `workforce_*`,
// `partner`, `account`, `journal_entry`, `tax_rate` and `payment` are registered before our entities and hooks.
import { defineModule, label, registry } from '@daifuku/kernel';
import { AccountingModule } from '@daifuku/mod-accounting';
import { PartnerModule } from '@daifuku/mod-partner';
import { PaymentModule } from '@daifuku/mod-payment';
import { PurchaseModule } from '@daifuku/mod-purchase';
import { TaxModule } from '@daifuku/mod-tax';
import { WorkforceModule } from '@daifuku/mod-workforce';
import { settlementCandidatesAction } from './actions/candidates.ts';
import { draftSettlementAction } from './actions/draft.ts';
import { todoAction } from './actions/todo.ts';
import { ExpenseAdvance, ExpenseSettlement, ExpenseSettlementLine } from './entities/index.ts';
import { expenseAccountsHealthCheck } from './health.ts';
import { registerAdvanceHooks } from './hooks/advance.ts';
import { registerLineHooks } from './hooks/lines.ts';
import { registerSettlementHooks } from './hooks/settlement.ts';
import { EXPENSE_SETTING_DEFS } from './settings.ts';

export const ExpenseModule = defineModule({
  name: 'expense',
  label: label('経費精算', 'Expense settlement'),
  depends: [
    WorkforceModule.name,
    PartnerModule.name,
    TaxModule.name,
    AccountingModule.name,
    PurchaseModule.name,
    PaymentModule.name,
  ],
  entities: [ExpenseSettlement, ExpenseSettlementLine, ExpenseAdvance],
  actions: [settlementCandidatesAction, draftSettlementAction, todoAction],
  hooks: () => {
    registerSettlementHooks();
    registerLineHooks();
    registerAdvanceHooks();
    for (const def of EXPENSE_SETTING_DEFS) registry.registerSetting(def);
    registry.registerHealthCheck(expenseAccountsHealthCheck);
  },
  menus: [
    { label: label('経費精算', 'Expense settlement'), route: '/finance/expenses', order: 62 },
    { label: label('経費精算書', 'Expense settlements'), entity: ExpenseSettlement.name, order: 63 },
    { label: label('仮払', 'Advances'), entity: ExpenseAdvance.name, order: 64 },
  ],
});
