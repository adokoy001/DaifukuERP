import type { z } from 'zod';
import { edgeClaimOutput, edgeCompleteOutput, edgeEventOutput, edgeHeartbeatOutput, edgeRoutes, edgeSessionOutput, edgeStartOutput, type EdgeDeviceEvent, type EdgeLease, type EdgeResult } from '@daifuku/mod-edge-integration/contract';
import type { EdgeConfig } from './config.ts';
import { bytesRequest } from './http.ts';
import { EdgeError } from './errors.ts';
export class RelayClient {
  constructor(readonly config: EdgeConfig, private readonly credential: () => string) {}
  url(route: string): URL { return new URL(this.config.apiBaseUrl.replace(/\/$/, '') + route); }
  async request<T>(route: string, method: 'GET' | 'POST', schema: z.ZodType<T>, input?: unknown, secret = this.credential()): Promise<T> {
    const body = input === undefined ? undefined : Buffer.from(JSON.stringify(input));
    const response = await bytesRequest(this.url(route), method, { accept: 'application/json', ...(body ? { 'content-type': 'application/json', 'content-length': String(body.length) } : {}), ...(secret ? { authorization: 'Bearer ' + secret } : {}) }, body, { timeoutMs: this.config.requestTimeoutMs, limitBytes: 131072, ...(this.config.caFile ? { caFile: this.config.caFile } : {}) });
    if (response.status === 401 || response.status === 403) throw new EdgeError('credential_rejected');
    if (response.status < 200 || response.status >= 300) throw new EdgeError('relay_request_rejected');
    let value: unknown; try { value = JSON.parse(response.body.toString('utf8')); } catch { throw new EdgeError('invalid_relay_response'); }
    const parsed = schema.safeParse(value); if (!parsed.success) throw new EdgeError('invalid_relay_response'); return parsed.data;
  }
  session(secret = this.credential()) { return this.request(edgeRoutes.session, 'GET', edgeSessionOutput, undefined, secret); }
  claim() { return this.request(edgeRoutes.claim, 'POST', edgeClaimOutput, {}); }
  start(lease: EdgeLease) { return this.request(edgeRoutes.start, 'POST', edgeStartOutput, lease); }
  heartbeat(lease: EdgeLease) { return this.request(edgeRoutes.heartbeat, 'POST', edgeHeartbeatOutput, lease); }
  complete(lease: EdgeLease, result: EdgeResult) { return this.request(edgeRoutes.complete, 'POST', edgeCompleteOutput, { ...lease, result }); }
  event(event: EdgeDeviceEvent) { return this.request(edgeRoutes.event, 'POST', edgeEventOutput, event); }
}
