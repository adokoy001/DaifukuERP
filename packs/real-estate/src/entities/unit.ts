// 部屋・区画 (spec AC-1). `status` is system-owned: hooks/unit-status.ts sets 'vacant' on create and re-derives it from the
// unit's submitted leases (contracts whose ext.unitId is this unit) on every update; contract submit/update/cancel and the
// move_in / move_out actions touch the unit when its derived status changes.
import { defineEntity, f, label } from '@daifuku/kernel';
import { UNIT_STATUSES } from '../services/rent-roll.ts';
import { UNIT_USAGES } from '../services/tax-rule.ts';

export const UNIT_USAGE_LABELS = {
  residential: label('住宅', 'Residential'),
  office: label('事務所', 'Office'),
  store: label('店舗', 'Store'),
  parking: label('駐車場', 'Parking'),
} as const;

export const RealEstateUnit = defineEntity({
  name: 'real_estate_unit',
  label: label('部屋・区画', 'Unit'),
  fields: {
    propertyId: f.ref('real_estate_property', { label: label('物件', 'Property'), required: true, index: true }),
    code: f.text({ label: label('部屋番号', 'Unit code'), required: true, maxLength: 20 }),
    name: f.text({ label: label('名称', 'Name'), required: true, maxLength: 100 }),
    usage: f.enum(UNIT_USAGES, {
      label: label('用途', 'Usage'),
      description: label(
        '契約明細の税区分の既定を決める（住宅 = 非課税、他 = 課税）',
        'Decides the default tax category of lease lines (residential = non-taxable, others = standard)',
      ),
      required: true,
      labels: UNIT_USAGE_LABELS,
    }),
    floorArea: f.decimal({ label: label('面積（㎡）', 'Floor area (m²)'), scale: 2, min: '0' }),
    monthlyRent: f.money({
      label: label('月額賃料（募集）', 'Monthly rent (asking)'),
      description: label('税抜', 'Tax-exclusive'),
      required: true,
      min: '0',
    }),
    status: f.enum(UNIT_STATUSES, {
      label: label('状態', 'Status'),
      description: label(
        '契約から自動計算（確定済みで終了日を過ぎていない契約があれば入居中）',
        'Computed from the leases (occupied while a submitted lease has not ended)',
      ),
      required: true,
      default: 'vacant',
      labels: { vacant: label('空室', 'Vacant'), occupied: label('入居中', 'Occupied') },
    }),
    note: f.text({ label: label('備考', 'Note'), multiline: true, maxLength: 2000 }),
  },
  unique: [['propertyId', 'code']],
  displayField: 'code',
  permissions: {
    roles: {
      sales: ['read', 'create', 'update', 'delete'],
      accounting: ['read'],
      viewer: ['read'],
    },
  },
  views: {
    list: ['propertyId', 'code', 'name', 'usage', 'floorArea', 'monthlyRent', 'status'],
    search: ['code', 'name'],
    form: [['propertyId', 'code', 'name'], ['usage', 'floorArea', 'monthlyRent', 'status'], ['note']],
  },
});
