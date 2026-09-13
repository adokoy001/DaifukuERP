import { defineEntity, f, label } from '@daifuku/kernel';
import { E, H, M, P, edit, read, owned } from './common.ts';
export const WorkforceSite = defineEntity({
  name: 'workforce_site',
  label: label('拠点・部署', 'Work sites'),
  ext: false,
  siteAccess: { kind: 'store', field: 'id' },
  fields: {
    code: f.text({ required: true, unique: true, maxLength: 40, label: label('拠点コード', 'Code') }),
    name: f.text({ required: true, maxLength: 100, label: label('拠点名', 'Name') }),
    active: f.bool({ required: true, default: true, label: label('有効', 'Active') }),
  },
  permissions: {
    roles: { [E]: read, [M]: read, [H]: edit, [P]: read, edge_manager: ['read'], edge_operator: ['read'] },
  },
  views: { list: ['code', 'name', 'active'], search: ['code', 'name'] },
});
export const WorkforceEmployee = defineEntity({
  name: 'workforce_employee',
  label: label('従業員', 'Employees'),
  ext: false,
  siteAccess: { kind: 'store', field: 'siteId' },
  fields: {
    userId: f.uuid({
      ...owned,
      required: true,
      immutable: true,
      unique: true,
      label: label('会社所属の利用者', 'Company user'),
    }),
    siteId: f.ref('workforce_site', { required: true, label: label('所属拠点', 'Site') }),
    code: f.text({ required: true, unique: true, maxLength: 40, label: label('社員番号', 'Employee code') }),
    name: f.text({ required: true, maxLength: 100, label: label('氏名', 'Name') }),
    hiredOn: f.date({ required: true, label: label('入社日', 'Hire date') }),
    terminatedOn: f.date({ label: label('退職日', 'Termination date') }),
    active: f.bool({ required: true, default: true, label: label('在籍・利用可能', 'Active') }),
  },
  permissions: {
    roles: { [E]: read, [M]: read, [H]: edit, [P]: read },
    rowRules: [{ roles: [E], where: { userId: '$ctx.userId' } }],
  },
  views: { list: ['code', 'name', 'siteId', 'active'], search: ['code', 'name'] },
});
