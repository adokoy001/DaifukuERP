import { defineEntity, f, label, type Infer } from '@daifuku/kernel';
import type { EdgeJobRequest, EdgeResult } from './contract.ts';
const owned = { serverOwned: true } as const;
const human = {
  edge_manager: ['read', 'create', 'update', 'export'] as const,
  edge_operator: ['read', 'create', 'update', 'export'] as const,
  workforce_hr: ['read'] as const,
};
const parent = { kind: 'parent', entity: 'edge_gateway', field: 'gatewayId' } as const;
export const EdgeGateway = defineEntity({
  name: 'edge_gateway',
  label: label('LAN中継機', 'LAN gateways'),
  ext: false,
  siteAccess: { kind: 'store', field: 'siteId' },
  relayAccess: { operations: ['read'], field: 'id' },
  fields: {
    siteId: f.ref('workforce_site', { ...owned, required: true, immutable: true }),
    code: f.text({ ...owned, required: true, unique: true, maxLength: 40 }),
    name: f.text({ ...owned, required: true, maxLength: 100 }),
    active: f.bool({ ...owned, required: true, default: true }),
    reason: f.text({ ...owned, maxLength: 1000 }),
  },
  permissions: { roles: { ...human, relay: ['read'] } },
  views: { list: ['code', 'name', 'siteId', 'active'] },
});
export const EdgeDevice = defineEntity({
  name: 'edge_device',
  label: label('店舗機器', 'Site devices'),
  ext: false,
  siteAccess: parent,
  relayAccess: { operations: ['read'], field: 'gatewayId' },
  fields: {
    gatewayId: f.ref(EdgeGateway.name, { ...owned, required: true, immutable: true }),
    localDeviceId: f.text({ ...owned, required: true, immutable: true, maxLength: 80 }),
    key: f.text({ ...owned, required: true, unique: true, outputHidden: true, maxLength: 120 }),
    name: f.text({ ...owned, required: true, maxLength: 100 }),
    driver: f.enum(['ipp_text', 'simulator'], { ...owned, required: true, immutable: true }),
    active: f.bool({ ...owned, required: true, default: true }),
    reason: f.text({ ...owned, maxLength: 1000 }),
  },
  permissions: { roles: { ...human, relay: ['read'] } },
  indexes: [['gatewayId', 'active']],
  views: { list: ['gatewayId', 'localDeviceId', 'name', 'driver', 'active'] },
});
export const EdgeJob = defineEntity({
  name: 'edge_job',
  label: label('機器処理履歴', 'Device jobs'),
  ext: false,
  siteAccess: parent,
  relayAccess: { operations: ['read', 'update'], field: 'gatewayId' },
  fields: {
    gatewayId: f.ref(EdgeGateway.name, { ...owned, required: true, immutable: true }),
    deviceId: f.ref(EdgeDevice.name, { ...owned, required: true, immutable: true }),
    idempotencyKey: f.uuid({ ...owned, required: true, unique: true }),
    kind: f.enum(['print.text', 'device.status', 'cash.dispense'], { ...owned, required: true }),
    request: f.json<EdgeJobRequest>({ ...owned, required: true, outputHidden: true }),
    payloadHash: f.text({ ...owned, required: true, maxLength: 64 }),
    state: f.enum(['queued', 'claimed', 'executing', 'succeeded', 'failed', 'uncertain', 'cancelled', 'expired'], {
      ...owned,
      required: true,
      default: 'queued',
    }),
    expiresAt: f.timestamp({ ...owned, required: true }),
    attempt: f.int({ ...owned, required: true, default: 0 }),
    leaseHash: f.text({ ...owned, outputHidden: true, maxLength: 64 }),
    leaseUntil: f.timestamp(owned),
    startedAt: f.timestamp(owned),
    result: f.json<EdgeResult>(owned),
    reason: f.text({ ...owned, maxLength: 1000 }),
    resolvedAt: f.timestamp(owned),
    evidence: f.text({ ...owned, maxLength: 2000 }),
  },
  permissions: { roles: { ...human, relay: ['read', 'update'] } },
  indexes: [
    ['gatewayId', 'state'],
    ['deviceId', 'state'],
  ],
  views: { list: ['deviceId', 'kind', 'state', 'attempt', 'expiresAt', 'reason'] },
});
export const EdgeDeviceEvent = defineEntity({
  name: 'edge_device_event',
  label: label('機器状態履歴', 'Device observations'),
  ext: false,
  siteAccess: parent,
  relayAccess: { operations: ['read', 'create'], field: 'gatewayId' },
  fields: {
    gatewayId: f.ref(EdgeGateway.name, { ...owned, required: true, immutable: true }),
    deviceId: f.ref(EdgeDevice.name, { ...owned, required: true, immutable: true }),
    eventId: f.uuid({ ...owned, required: true }),
    key: f.text({ ...owned, required: true, unique: true, outputHidden: true, maxLength: 80 }),
    localDeviceId: f.text({ ...owned, required: true, maxLength: 80 }),
    observedAt: f.timestamp({ ...owned, required: true }),
    receivedAt: f.timestamp({ ...owned, required: true }),
    status: f.enum(['online', 'offline', 'busy', 'unknown', 'error'], { ...owned, required: true }),
    code: f.text({ ...owned, required: true, maxLength: 64 }),
    bodyHash: f.text({ ...owned, required: true, outputHidden: true, maxLength: 64 }),
  },
  permissions: { roles: { ...human, relay: ['read', 'create'] } },
  indexes: [['gatewayId', 'receivedAt']],
  views: { list: ['deviceId', 'status', 'code', 'observedAt', 'receivedAt'] },
});
export type Gateway = Infer<typeof EdgeGateway>;
export type Device = Infer<typeof EdgeDevice>;
export type Job = Infer<typeof EdgeJob>;
