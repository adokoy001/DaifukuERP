// Module manifest (docs/conventions/layers.md). Importing @daifuku/mod-partner first registers the partner entity
// that journal_line references and satisfies `depends`.
import { defineModule, label } from '@daifuku/kernel';
import { PartnerModule } from '@daifuku/mod-partner';
import { closePeriodAction, reopenPeriodAction } from './actions/close-period.ts';
import { generalLedgerAction } from './actions/general-ledger.ts';
import { openFiscalYearAction } from './actions/open-fiscal-year.ts';
import { postFromSourceAction } from './actions/post-from-source.ts';
import { reverseEntryAction } from './actions/reverse-entry.ts';
import { taxPeriodSummaryAction } from './actions/tax-period-summary.ts';
import { trialBalanceAction } from './actions/trial-balance.ts';
import { Account } from './entities/account.ts';
import { FiscalPeriod } from './entities/fiscal-period.ts';
import { FiscalYear } from './entities/fiscal-year.ts';
import { JournalEntry } from './entities/journal-entry.ts';
import { JournalLine } from './entities/journal-line.ts';
import { registerFiscalDateHooks } from './hooks/fiscal-dates.ts';
import { registerFreezeLinesHook } from './hooks/freeze-lines.ts';
import { registerNoCancelHook } from './hooks/no-cancel.ts';
import { registerValidateEntryHook } from './hooks/validate-entry.ts';
import { seedFiscalYear } from './seeds/fiscal-year.ts';

export const AccountingModule = defineModule({
  name: 'accounting',
  label: label('会計', 'Accounting'),
  depends: [PartnerModule.name],
  entities: [Account, FiscalYear, FiscalPeriod, JournalEntry, JournalLine],
  actions: [openFiscalYearAction, postFromSourceAction, reverseEntryAction, trialBalanceAction, generalLedgerAction, taxPeriodSummaryAction, closePeriodAction, reopenPeriodAction],
  hooks: () => {
    registerValidateEntryHook();
    registerNoCancelHook();
    registerFreezeLinesHook();
    registerFiscalDateHooks();
  },
  seed: seedFiscalYear,
  menus: [
    { label: label('仕訳', 'Journal entries'), entity: JournalEntry.name, order: 30 },
    { label: label('勘定科目', 'Accounts'), entity: Account.name, order: 31 },
    { label: label('会計年度', 'Fiscal years'), entity: FiscalYear.name, order: 32 },
    { label: label('会計期間', 'Fiscal periods'), entity: FiscalPeriod.name, order: 33 },
    { label: label('試算表', 'Trial balance'), route: `/r/${trialBalanceAction.name}`, order: 34 },
    { label: label('消費税集計表', 'Consumption tax summary'), route: `/r/${taxPeriodSummaryAction.name}`, order: 35 },
  ],
  roles: { accounting: label('経理', 'Accounting') },
});
