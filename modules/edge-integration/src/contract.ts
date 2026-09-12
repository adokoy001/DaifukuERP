// Pure transport contract shared by browser, API and the outbound-only LAN agent.
import { z } from 'zod';
export const EDGE_PROTOCOL_VERSION = 1;
export const EDGE_LEASE_SECONDS = 90;
export const EDGE_POLL_MS = 15000;
export const EDGE_HEARTBEAT_MS = 20000;
export const edgeRoutes = { pair: '/relay/pair', session: '/relay/session', rotate: '/relay/credentials/rotate', claim: '/relay/jobs/claim', start: '/relay/jobs/start', heartbeat: '/relay/jobs/heartbeat', complete: '/relay/jobs/complete', event: '/relay/events', notifications: '/relay/notifications' } as const;
export const edgeSecret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const edgeTime = z.iso.datetime({ offset: true });
export const edgeDeviceDriver = z.enum(['ipp_text', 'simulator']);
export const edgeJobState = z.enum(['queued', 'claimed', 'executing', 'succeeded', 'failed', 'uncertain', 'cancelled', 'expired']);
export const edgeJobRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('print.text'), payload: z.object({ text: z.string().min(1).max(16000), title: z.string().min(1).max(100), copies: z.number().int().min(1).max(5) }).strict() }).strict(),
  z.object({ kind: z.literal('device.status'), payload: z.object({}).strict() }).strict(),
  z.object({ kind: z.literal('cash.dispense'), payload: z.object({ amount: z.string().regex(/^[1-9][0-9]{0,5}$/), currency: z.literal('JPY') }).strict() }).strict(),
]);
export type EdgeJobRequest = z.infer<typeof edgeJobRequest>;
export const edgePairInput = z.object({ pairingToken: edgeSecret, credentialSecret: edgeSecret, protocolVersion: z.literal(1), agentVersion: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/) }).strict();
export const edgeRotateInput = z.object({ rotationId: z.uuid(), newCredentialSecret: edgeSecret }).strict();
export const edgeSessionOutput = z.object({ gatewayId: z.uuid(), companyId: z.uuid(), siteId: z.uuid(), credentialVersion: z.number().int().positive(), credentialExpiresAt: edgeTime, serverTime: edgeTime, protocolVersion: z.literal(1), pollAfterMs: z.number().int().positive(), heartbeatAfterMs: z.number().int().positive() });
export type EdgeSession = z.infer<typeof edgeSessionOutput>;
export const edgeLease = z.object({ jobId: z.uuid(), leaseToken: edgeSecret, attempt: z.number().int().positive() }).strict();
export type EdgeLease = z.infer<typeof edgeLease>;
export const edgeClaimedJob = z.object({ id: z.uuid(), deviceId: z.uuid(), localDeviceId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), driver: edgeDeviceDriver, request: edgeJobRequest, payloadHash: z.string().regex(/^[a-f0-9]{64}$/), leaseToken: edgeSecret, attempt: z.number().int().positive(), leaseUntil: edgeTime, expiresAt: edgeTime });
export type EdgeClaimedJob = z.infer<typeof edgeClaimedJob>;
export const edgeClaimOutput = z.object({ job: edgeClaimedJob.nullable(), serverTime: edgeTime, pollAfterMs: z.number().int().positive() });
export const edgeStartOutput = z.object({ startGranted: z.boolean(), state: edgeJobState, leaseUntil: edgeTime.nullable(), serverTime: edgeTime });
export const edgeHeartbeatOutput = z.object({ accepted: z.boolean(), state: edgeJobState, leaseUntil: edgeTime.nullable(), serverTime: edgeTime });
export const edgeResult = z.object({ state: z.enum(['succeeded', 'failed', 'uncertain']), code: z.string().regex(/^[a-z0-9_-]{1,64}$/), deviceJobId: z.string().max(100).optional(), summary: z.string().max(500).optional() }).strict();
export type EdgeResult = z.infer<typeof edgeResult>;
export const edgeCompleteInput = edgeLease.extend({ result: edgeResult }).strict();
export const edgeCompleteOutput = z.object({ accepted: z.boolean(), state: edgeJobState, version: z.number().int().positive(), ignored: z.enum(['obsolete_attempt', 'manually_resolved']).optional() });
export const edgeEventInput = z.object({ eventId: z.uuid(), deviceId: z.uuid(), localDeviceId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), observedAt: edgeTime, status: z.enum(['online', 'offline', 'busy', 'unknown', 'error']), code: z.string().regex(/^[a-z0-9_-]{1,64}$/) }).strict();
export type EdgeDeviceEvent = z.infer<typeof edgeEventInput>;
export const edgeEventOutput = z.object({ ok: z.literal(true), duplicate: z.boolean(), ignored: z.literal('expired').optional() });
export const edgeNotification = z.object({ type: z.literal('jobs_available'), protocolVersion: z.literal(1) }).strict();
export const enqueueEdgeJobInput = z.object({ deviceId: z.uuid(), idempotencyKey: z.uuid(), request: edgeJobRequest, expiresAt: edgeTime }).strict();
export const edgeBoardInput = z.object({ gatewayId: z.uuid().optional() }).strict();
export const edgeJobCommand = z.object({ jobId: z.uuid(), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(1).max(1000) }).strict();
export const resolveEdgeJobInput = edgeJobCommand.extend({ resolution: z.enum(['succeeded', 'failed']), evidence: z.string().trim().min(1).max(2000) }).strict();
export const edgePairingInput = z.object({ gatewayId: z.uuid(), expectedVersion: z.number().int().positive(), stepUpToken: edgeSecret }).strict();
export const edgeRevokeInput = z.object({ gatewayId: z.uuid(), expectedVersion: z.number().int().positive(), stepUpToken: edgeSecret, reason: z.string().trim().min(1).max(1000) }).strict();
export const edgeJobCommandOutput = z.object({ id: z.uuid(), version: z.number().int().positive(), state: edgeJobState });

/** Stable canonical wire JSON used as the SHA-256 payloadHash input. */
export function edgePayloadText(request: EdgeJobRequest): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, item]) => [key, canonical(item)])) : value;
  return JSON.stringify(canonical(request));
}

export const createEdgeGatewayInput = z.object({ siteId: z.uuid(), code: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(100) }).strict();
export const registerEdgeDeviceInput = z.object({ gatewayId: z.uuid(), localDeviceId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), name: z.string().trim().min(1).max(100), driver: edgeDeviceDriver }).strict();
const edgeActiveFields = { expectedVersion: z.number().int().positive(), active: z.boolean(), reason: z.string().trim().min(1).max(1000) };
export const setEdgeGatewayActiveInput = z.object({ gatewayId: z.uuid(), ...edgeActiveFields }).strict();
export const setEdgeDeviceActiveInput = z.object({ deviceId: z.uuid(), ...edgeActiveFields }).strict();
export const edgeActiveInput = z.object({ id: z.uuid(), expectedVersion: z.number().int().positive(), active: z.boolean(), reason: z.string().trim().min(1).max(1000) }).strict();
export const edgeGatewayView = z.object({ id: z.uuid(), version: z.number().int(), siteId: z.uuid(), code: z.string(), name: z.string(), active: z.boolean(), paired: z.boolean(), lastSeenAt: edgeTime.nullable(), credentialExpiresAt: edgeTime.nullable() });
export const edgeDeviceView = z.object({ id: z.uuid(), version: z.number().int(), gatewayId: z.uuid(), localDeviceId: z.string(), name: z.string(), driver: edgeDeviceDriver, active: z.boolean() });
export const edgeJobView = z.object({ id: z.uuid(), version: z.number().int(), gatewayId: z.uuid(), deviceId: z.uuid(), kind: z.string(), state: edgeJobState, createdAt: edgeTime, expiresAt: edgeTime, attempt: z.number().int(), result: edgeResult.nullable(), reason: z.string().nullable(), evidence: z.string().nullable(), resolvedAt: edgeTime.nullable() });
export const edgeEventView = edgeEventInput.extend({ id: z.uuid(), gatewayId: z.uuid(), receivedAt: edgeTime });
export const edgeBoardOutput = z.object({ gateways: z.array(edgeGatewayView), devices: z.array(edgeDeviceView), jobs: z.array(edgeJobView), events: z.array(edgeEventView), serverTime: edgeTime, truncated: z.boolean() });
export type EdgeBoard = z.infer<typeof edgeBoardOutput>;
