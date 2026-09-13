import { defineEntity, f, label } from '@daifuku/kernel';

export const ApplianceDevice = defineEntity({
  name: 'appliance_store_device',
  label: label('顧客の家電', 'Customer appliance'),
  fields: {
    code: f.text({
      label: label('機器管理番号', 'Device code'),
      required: true,
      unique: true,
      immutable: true,
      maxLength: 40,
    }),
    partnerId: f.ref('partner', { label: label('お客様', 'Customer'), required: true, immutable: true, index: true }),
    productId: f.ref('product', { label: label('商品', 'Product'), immutable: true }),
    name: f.text({ label: label('機器名', 'Device name'), required: true, maxLength: 200 }),
    manufacturer: f.text({ label: label('メーカー', 'Manufacturer'), maxLength: 100 }),
    model: f.text({ label: label('型番', 'Model'), required: true, maxLength: 100 }),
    serialNumber: f.text({ label: label('製造番号', 'Serial number'), immutable: true, maxLength: 100 }),
    location: f.text({ label: label('設置場所', 'Installed location'), maxLength: 300 }),
    purchaseDate: f.date({ label: label('購入日', 'Purchase date') }),
    warrantyUntil: f.date({ label: label('保証期限（記録）', 'Recorded warranty expiry') }),
    contractId: f.ref('contract', { label: label('保守契約', 'Maintenance contract') }),
    note: f.text({ label: label('備考', 'Note'), multiline: true, maxLength: 2000 }),
  },
  displayField: 'name',
  permissions: { roles: { sales: ['read', 'create', 'update', 'delete'], accounting: ['read'], viewer: ['read'] } },
  views: {
    list: ['code', 'name', 'partnerId', 'model', 'serialNumber', 'warrantyUntil'],
    search: ['code', 'name', 'model', 'serialNumber'],
    form: [
      ['code', 'name', 'partnerId'],
      ['productId', 'manufacturer', 'model', 'serialNumber'],
      ['location', 'purchaseDate', 'warrantyUntil'],
      ['contractId', 'note'],
    ],
  },
});
