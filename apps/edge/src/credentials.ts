import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { edgeRoutes, edgeSecret, edgeSessionOutput, type EdgeSession } from '@daifuku/mod-edge-integration/contract';
import { RelayClient } from './client.ts';
import type { EdgeConfig } from './config.ts';
import { EdgeError } from './errors.ts';
import { missingFile, readPrivateJson, syncJson } from './files.ts';
const stateSchema = z.object({ apiBaseUrl: z.string(), current: edgeSecret.optional(), pending: edgeSecret.optional(), rotationId: z.uuid().optional(), gatewayId: z.uuid().optional() }).strict();
type CredentialState = z.infer<typeof stateSchema>;
export class Credentials {
  readonly client: RelayClient;
  private constructor(private readonly path: string, config: EdgeConfig, private state: CredentialState) { this.client = new RelayClient(config, () => this.state.current ?? ''); }
  static async open(directory: string, config: EdgeConfig): Promise<Credentials> {
    const path = join(directory, 'credentials.json'); let state: CredentialState = { apiBaseUrl: config.apiBaseUrl };
    try { const parsed = stateSchema.safeParse(await readPrivateJson(path, 8192)); if (!parsed.success) throw new EdgeError('invalid_credentials_file'); state = parsed.data; } catch (error) { if (!missingFile(error)) throw error; }
    if (state.apiBaseUrl !== config.apiBaseUrl) throw new EdgeError('credential_endpoint_mismatch');
    return new Credentials(path, config, state);
  }
  private async save(state: CredentialState): Promise<void> { await syncJson(this.path, state, 8192); this.state = state; }
  private async commit(session: EdgeSession): Promise<EdgeSession> {
    if (this.state.gatewayId && session.gatewayId !== this.state.gatewayId) throw new EdgeError('gateway_identity_mismatch');
    const secret = this.state.pending ?? this.state.current; if (!secret) throw new EdgeError('pairing_required');
    await this.save({ apiBaseUrl: this.state.apiBaseUrl, current: secret, gatewayId: session.gatewayId }); return session;
  }
  private async pendingSession(): Promise<EdgeSession | null> {
    if (!this.state.pending) return null;
    try { return await this.commit(await this.client.session(this.state.pending)); }
    catch (error) { if (error instanceof EdgeError && error.code === 'credential_rejected') return null; throw error; }
  }
  async session(): Promise<EdgeSession> {
    const pending = await this.pendingSession(); if (pending) return pending;
    if (!this.state.current) throw new EdgeError('pairing_required');
    if (this.state.pending && this.state.rotationId) return this.rotate();
    const session = await this.client.session();
    if (this.state.gatewayId && session.gatewayId !== this.state.gatewayId) throw new EdgeError('gateway_identity_mismatch'); return session;
  }
  async pair(pairingToken: string): Promise<EdgeSession> {
    const token = edgeSecret.safeParse(pairingToken); if (!token.success) throw new EdgeError('invalid_pairing_token');
    const recovered = await this.pendingSession(); if (recovered) return recovered;
    if (!this.state.pending || this.state.rotationId) await this.save({ ...this.state, pending: randomBytes(32).toString('base64url'), rotationId: undefined });
    const session = await this.client.request(edgeRoutes.pair, 'POST', edgeSessionOutput, { pairingToken, credentialSecret: this.state.pending, protocolVersion: 1, agentVersion: '0.0.1' }, '');
    return this.commit(session);
  }
  async rotate(): Promise<EdgeSession> {
    const recovered = await this.pendingSession(); if (recovered) return recovered;
    if (!this.state.current) throw new EdgeError('pairing_required');
    if (!this.state.pending || !this.state.rotationId) await this.save({ ...this.state, pending: randomBytes(32).toString('base64url'), rotationId: randomUUID() });
    const session = await this.client.request(edgeRoutes.rotate, 'POST', edgeSessionOutput, { rotationId: this.state.rotationId, newCredentialSecret: this.state.pending }); return this.commit(session);
  }
  authorization(): string { if (!this.state.current) throw new EdgeError('pairing_required'); return this.state.current; }
}
