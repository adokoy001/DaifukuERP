import { defineModule, label } from '@daifuku/kernel';
import { WorkforceModule } from '@daifuku/mod-workforce';
import { EdgeGateway, EdgeDevice, EdgeJob, EdgeDeviceEvent } from './entities.ts';
import * as actions from './actions.ts';
import { registerEdgeGuards } from './internal.ts';
export const EdgeIntegrationModule = defineModule({ name: 'edge', label: label('店舗機器連携', 'Site device integration'), depends: [WorkforceModule.name], entities: [EdgeGateway, EdgeDevice, EdgeJob, EdgeDeviceEvent], actions: Object.values(actions), hooks: registerEdgeGuards, roles: { edge_manager: label('機器管理者', 'Device manager'), edge_operator: label('機器担当者', 'Device operator') }, menus: [{ label: label('店舗機器連携', 'Site device integration'), route: '/operations/devices', order: 95 }] });
