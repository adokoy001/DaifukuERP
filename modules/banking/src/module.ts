import { defineModule, label } from '@daifuku/kernel';
import { ContractModule } from '@daifuku/mod-contract';
import { PaymentModule } from '@daifuku/mod-payment';
import { WorkforceModule } from '@daifuku/mod-workforce';
import { bankingEntities } from './entities.ts';
import * as actions from './actions.ts';
import { registerBankGuards } from './internal.ts';
export const BankingModule = defineModule({
  name: 'banking',
  label: label('銀行連携', 'Banking'),
  depends: [PaymentModule.name, ContractModule.name, WorkforceModule.name],
  entities: [...bankingEntities],
  actions: Object.values(actions),
  hooks: registerBankGuards,
  menus: [
    { label: label('銀行明細・支払資料', 'Bank statements and transfer files'), route: '/finance/banking', order: 96 },
    { label: label('資金繰り表', 'Cash forecast'), route: '/finance/cash-forecast', order: 97 },
  ],
});
