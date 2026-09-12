import { defineModule, label } from '@daifuku/kernel';
import { AccountingModule } from '@daifuku/mod-accounting';
import { WorkforceModule } from '@daifuku/mod-workforce';
import { FilingAccountingProfile, FilingPayrollProfile, FilingAccountingPack, FilingPayrollPack } from './entities.ts';
import * as actions from './actions.ts';
import { registerFilingGuards } from './internal.ts';
export const TaxFilingModule = defineModule({ name: 'tax_filing', label: label('申告準備', 'Tax filing preparation'), depends: [AccountingModule.name, WorkforceModule.name], entities: [FilingAccountingProfile, FilingPayrollProfile, FilingAccountingPack, FilingPayrollPack], actions: Object.values(actions), hooks: registerFilingGuards, menus: [{ label: label('申告準備', 'Filing preparation'), route: '/finance/filing', order: 96 }] });
