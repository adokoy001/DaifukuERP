import { defineModule, label } from '@daifuku/kernel';
import { AccountingModule } from '@daifuku/mod-accounting';
import { PosLocation, PosInbox, PosTransaction } from './entities.ts';
import { retryPosAction, correctPosAction, posInboxAction } from './actions.ts';
import { registerPosGuards } from './internal.ts';
import { registerLocationGuards } from './location.ts';
export const PosIntegrationModule = defineModule({ name: 'pos_integration', label: label('POS自動連携', 'POS integration'), depends: [AccountingModule.name], entities: [PosLocation, PosInbox, PosTransaction], actions: [retryPosAction, correctPosAction, posInboxAction], hooks: () => { registerPosGuards(); registerLocationGuards(); }, menus: [{ label: label('POS連携店舗', 'POS locations'), entity: PosLocation.name, order: 90 }, { label: label('POS受信履歴', 'POS inbox'), entity: PosInbox.name, order: 91 }, { label: label('POS決済原資料', 'POS settlement sources'), entity: PosTransaction.name, order: 92 }] });
