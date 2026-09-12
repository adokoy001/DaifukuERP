// Module manifest (docs/conventions/layers.md).
import { defineModule, label } from '@daifuku/kernel';
import { computeDueDateAction } from './actions/compute-due-date.ts';
import { Partner } from './entities/partner.ts';
import { registerUniqueCodeHook } from './hooks/unique-code.ts';
import { seedPartners } from './seeds/partners.ts';

export const PartnerModule = defineModule({
  name: 'partner',
  label: label('取引先', 'Partners'),
  depends: [],
  entities: [Partner],
  actions: [computeDueDateAction],
  hooks: () => {
    registerUniqueCodeHook();
  },
  seed: seedPartners,
  menus: [{ label: label('取引先', 'Partners'), entity: 'partner', order: 10 }],
  roles: {
    sales: label('営業', 'Sales'),
    purchasing: label('購買', 'Purchasing'),
    accounting: label('経理', 'Accounting'),
    viewer: label('閲覧者', 'Viewer'),
  },
});
