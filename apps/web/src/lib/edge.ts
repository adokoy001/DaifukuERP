import { edgeJobRequest, type EdgeJobRequest } from '@daifuku/mod-edge-integration/contract';
import type { EntityMeta } from '../api/types.ts';
export function edgeEntityForUi(entity: EntityMeta): EntityMeta {
  if (!['edge_gateway', 'edge_device', 'edge_job', 'edge_device_event'].includes(entity.name)) return entity;
  return { ...entity, ops: entity.ops.filter((op) => op === 'read' || op === 'export') };
}
export function edgePrintRequest(data: FormData): EdgeJobRequest {
  return edgeJobRequest.parse({ kind: 'print.text', payload: { title: String(data.get('title') ?? ''), text: String(data.get('text') ?? ''), copies: Number(data.get('copies')) } });
}
export function edgeExpiry(serverTime: string, minutes: number): string {
  const instant = Date.parse(serverTime);
  if (!Number.isFinite(instant) || !Number.isInteger(minutes) || minutes < 1 || minutes > 60) throw new Error('Invalid execution deadline');
  return new Date(instant + minutes * 60_000).toISOString();
}
export function edgeRecentResponse(lastSeenAt: unknown, serverTime: string): boolean {
  if (typeof lastSeenAt !== 'string') return false;
  const age = Date.parse(serverTime) - Date.parse(lastSeenAt);
  return Number.isFinite(age) && age >= 0 && age <= 90_000;
}
