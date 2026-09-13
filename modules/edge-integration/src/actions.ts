import { defineAction, label } from '@daifuku/kernel';
import { z } from 'zod';
import * as c from './contract.ts';
import * as h from './human.ts';
import { edgeBoard } from './board.ts';
const manager = { roles: ['edge_manager'] },
  operator = { roles: ['edge_manager', 'edge_operator'] };
const allowed = { siteAccess: true };
const record = z.object({ id: z.uuid(), version: z.number().int().positive() });
export const boardAction = defineAction({
  ...allowed,
  name: 'edge.board',
  description: label('機器連携の運用状況', 'Edge operations board'),
  input: c.edgeBoardInput,
  output: c.edgeBoardOutput,
  permission: operator,
  handler: edgeBoard,
});
export const createGatewayAction = defineAction({
  ...allowed,
  name: 'edge.create_gateway',
  description: label('LAN中継機を登録', 'Register LAN gateway'),
  input: c.createEdgeGatewayInput,
  output: record,
  permission: manager,
  handler: h.createGateway,
});
export const registerDeviceAction = defineAction({
  ...allowed,
  name: 'edge.register_device',
  description: label('店舗機器を登録', 'Register a site device'),
  input: c.registerEdgeDeviceInput,
  output: record,
  permission: manager,
  handler: h.registerDevice,
});
export const enqueueAction = defineAction({
  ...allowed,
  name: 'edge.enqueue',
  description: label('機器処理を依頼', 'Enqueue a device operation'),
  input: c.enqueueEdgeJobInput,
  output: c.edgeJobCommandOutput,
  permission: operator,
  handler: h.enqueueJob,
});
export const cancelAction = defineAction({
  ...allowed,
  name: 'edge.cancel',
  description: label('未開始の依頼を取消', 'Cancel queued device work'),
  input: c.edgeJobCommand,
  output: c.edgeJobCommandOutput,
  permission: operator,
  handler: h.cancelJob,
});
export const resolveAction = defineAction({
  ...allowed,
  name: 'edge.resolve',
  description: label('機器の結果を確認し解決', 'Resolve an uncertain physical result'),
  input: c.resolveEdgeJobInput,
  output: c.edgeJobCommandOutput,
  permission: manager,
  handler: h.resolveJob,
});
export const gatewayActiveAction = defineAction({
  ...allowed,
  name: 'edge.set_gateway_active',
  description: label('中継機の利用を切替', 'Set gateway active state'),
  input: c.setEdgeGatewayActiveInput,
  output: record,
  permission: manager,
  handler: h.setGatewayActive,
});
export const deviceActiveAction = defineAction({
  ...allowed,
  name: 'edge.set_device_active',
  description: label('店舗機器の利用を切替', 'Set device active state'),
  input: c.setEdgeDeviceActiveInput,
  output: record,
  permission: manager,
  handler: h.setDeviceActive,
});
