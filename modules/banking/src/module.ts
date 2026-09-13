import { defineModule, label } from '@daifuku/kernel';
import { PaymentModule } from '@daifuku/mod-payment';
import { bankingEntities } from './entities.ts';
import * as actions from './actions.ts';
import { registerBankGuards } from './internal.ts';
export const BankingModule = defineModule({
  name: 'banking',
  label: label('銀行連携', 'Banking'),
  depends: [PaymentModule.name],
  entities: [...bankingEntities],
  actions: Object.values(actions),
  hooks: registerBankGuards,
  menus: [
    { label: label('銀行明細・支払資料', 'Bank statements and transfer files'), route: '/finance/banking', order: 96 },
  ],
});
