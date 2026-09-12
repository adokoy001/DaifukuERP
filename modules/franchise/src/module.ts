import { defineModule, label } from '@daifuku/kernel';
import { SalesModule } from '@daifuku/mod-sales';
import { PurchaseModule } from '@daifuku/mod-purchase';
import { PaymentModule } from '@daifuku/mod-payment';
import { FranchiseAgreement, FranchiseSettlement } from './entities.ts';
import { registerFranchiseGuards } from './internal.ts';
import * as actions from './actions.ts';
export const FranchiseModule = defineModule({ name: 'franchise', label: label('FC月次精算', 'Franchise settlement'), depends: [SalesModule.name, PurchaseModule.name, PaymentModule.name], entities: [FranchiseAgreement, FranchiseSettlement], actions: Object.values(actions), hooks: registerFranchiseGuards, menus: [{ label: label('FC精算契約', 'Franchise agreements'), entity: FranchiseAgreement.name, order: 95 }, { label: label('FC月次精算', 'Franchise settlements'), entity: FranchiseSettlement.name, order: 96 }] });
