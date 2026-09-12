import { defineDocument, f, label } from '@daifuku/kernel';
import { FarmCrop, FarmField } from './masters.ts';

export const FarmSeason = defineDocument({
  name: 'farm_season', label: label('作期', 'Growing season'),
  naming: { type: 'sequence', prefix: 'FSE-', period: 'year' },
  fields: {
    sampleKey: f.text({ label: label('サンプル識別キー', 'Sample key'), unique: true, immutable: true, serverOwned: true, maxLength: 80 }),
    name: f.text({ label: label('作期名', 'Season name'), required: true, maxLength: 200 }),
    fieldId: f.ref(FarmField.name, { label: label('圃場', 'Field'), required: true }),
    cropId: f.ref(FarmCrop.name, { label: label('作物', 'Crop'), required: true }),
    startDate: f.date({ label: label('開始日', 'Start date'), required: true }),
    endDate: f.date({ label: label('終了予定日', 'Planned end date'), required: true }),
    closedDate: f.date({ label: label('作期終了日', 'Closed date'), serverOwned: true }),
    note: f.text({ label: label('備考', 'Note'), multiline: true, maxLength: 2000 }),
  },
  allowOnSubmit: ['closedDate'], displayField: 'name',
  permissions: { roles: { inventory: ['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'], viewer: ['read'], sales: ['read'], purchasing: ['read'], accounting: ['read'] } },
  views: { list: ['name', 'fieldId', 'cropId', 'startDate', 'endDate', 'closedDate'], search: ['name'], form: [['name'], ['fieldId', 'cropId'], ['startDate', 'endDate', 'closedDate'], ['note']] },
});
