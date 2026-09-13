import { defineModule, label } from '@daifuku/kernel';
import { AccountingModule } from '@daifuku/mod-accounting';
import { GroupRun } from './entity.ts';
import { registerGroupGuards } from './internal.ts';
import * as actions from './actions.ts';
export const GroupAccountingModule = defineModule({
  name: 'group_accounting',
  label: label('グループ連結精算表', 'Group consolidation worksheets'),
  depends: [AccountingModule.name],
  entities: [GroupRun],
  actions: Object.values(actions),
  hooks: registerGroupGuards,
  menus: [{ label: label('連結精算表', 'Consolidation worksheets'), entity: GroupRun.name, order: 93 }],
});
