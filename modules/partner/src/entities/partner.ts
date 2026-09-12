// Partner master (docs/specs/partner.md): customers, suppliers and other counterparties in one entity.
// Japanese rules (登録番号 T+13桁, 半角カナ名義, 締め日/支払サイト) are cited in docs/domain/japan-tax.md.
import { defineEntity, f, label } from '@daifuku/kernel';
import { END_OF_MONTH } from '../services/due-date.ts';

export const Partner = defineEntity({
  name: 'partner',
  label: label('取引先', 'Partner'),
  fields: {
    code: f.text({ label: label('取引先コード', 'Code'), unique: true, immutable: true, maxLength: 20 }),
    name: f.text({ label: label('名称', 'Name'), required: true, maxLength: 200 }),
    nameKana: f.text({ label: label('カナ名称', 'Name (kana)'), normalize: 'halfwidth-kana', maxLength: 100 }),
    isCustomer: f.bool({ label: label('顧客', 'Customer'), required: true, default: false }),
    isSupplier: f.bool({ label: label('仕入先', 'Supplier'), required: true, default: false }),
    invoiceRegistrationNo: f.text({
      label: label('登録番号', 'Invoice registration no.'),
      description: label('適格請求書発行事業者の登録番号（T+13桁）', 'Qualified invoice issuer number (T + 13 digits)'),
      pattern: /^T\d{13}$/,
    }),
    taxStatus: f.enum(['registered', 'exempt'], {
      label: label('課税区分', 'Tax status'),
      required: true,
      default: 'registered',
      labels: { registered: label('課税事業者', 'Registered'), exempt: label('免税事業者', 'Exempt') },
    }),
    closingDay: f.int({ label: label('締め日', 'Closing day'), description: label('31 は月末', '31 means end of month'), required: true, default: END_OF_MONTH, min: 1, max: 31 }),
    paymentMonthOffset: f.int({ label: label('支払月', 'Payment month offset'), description: label('締め月からの月数', 'Months after the closing month'), required: true, default: 1, min: 0, max: 3 }),
    paymentDay: f.int({ label: label('支払日', 'Payment day'), description: label('31 は月末', '31 means end of month'), required: true, default: END_OF_MONTH, min: 1, max: 31 }),
    postalCode: f.text({ label: label('郵便番号', 'Postal code'), pattern: /^\d{3}-?\d{4}$/ }),
    prefecture: f.text({ label: label('都道府県', 'Prefecture'), maxLength: 10 }),
    address1: f.text({ label: label('住所1', 'Address 1'), maxLength: 200 }),
    address2: f.text({ label: label('住所2', 'Address 2'), maxLength: 200 }),
    phone: f.text({ label: label('電話', 'Phone'), maxLength: 30 }),
    email: f.text({ label: label('メール', 'Email'), maxLength: 200 }),
    bankName: f.text({ label: label('銀行名', 'Bank'), maxLength: 100 }),
    bankBranch: f.text({ label: label('支店', 'Branch'), maxLength: 100 }),
    bankAccountType: f.enum(['ordinary', 'current', 'savings'], {
      label: label('預金種目', 'Account type'),
      labels: { ordinary: label('普通', 'Ordinary'), current: label('当座', 'Current'), savings: label('貯蓄', 'Savings') },
    }),
    bankAccountNo: f.text({ label: label('口座番号', 'Account no.'), pattern: /^\d{1,7}$/ }),
    bankAccountHolderKana: f.text({ label: label('口座名義カナ', 'Account holder (kana)'), normalize: 'halfwidth-kana', maxLength: 30 }),
    notes: f.text({ label: label('備考', 'Notes'), multiline: true }),
    isActive: f.bool({ label: label('有効', 'Active'), required: true, default: true }),
  },
  permissions: {
    roles: {
      sales: ['read', 'create', 'update'],
      purchasing: ['read', 'create', 'update'],
      accounting: ['read', 'update', 'export'],
      viewer: ['read'],
    },
  },
  views: {
    list: ['code', 'name', 'nameKana', 'isCustomer', 'isSupplier', 'taxStatus'],
    search: ['name', 'nameKana', 'code'],
    form: [
      ['code', 'name', 'nameKana'],
      ['isCustomer', 'isSupplier', 'isActive'],
      ['invoiceRegistrationNo', 'taxStatus'],
      ['closingDay', 'paymentMonthOffset', 'paymentDay'],
      ['postalCode', 'prefecture', 'address1', 'address2', 'phone', 'email'],
      ['bankName', 'bankBranch', 'bankAccountType', 'bankAccountNo', 'bankAccountHolderKana'],
      ['notes'],
    ],
  },
});

export type PartnerDef = typeof Partner;
