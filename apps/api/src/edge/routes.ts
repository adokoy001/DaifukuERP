import { acceptRelayPairing, assertRelayCredential, issueRelayPairing, revokeRelayCredentials, rotateRelayCredential, touchRelayPresence, withRelayOperator, withContext, identityRateLimit } from '@daifuku/kernel';
import { claimJob, startJob, heartbeatJob, completeJob, recordDeviceEvent, liveGateway, expected, relayWork } from '@daifuku/mod-edge-integration';
import * as c from '@daifuku/mod-edge-integration/contract';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse } from '../request-context.ts';
import { withRelayRequest, sessionView, type EdgeOptions } from './context.ts';
import { registerRelaySockets } from './sockets.ts';
const empty = z.object({}).strict();
export async function registerRelayRoutes(server: FastifyInstance, opts: EdgeOptions) {
  server.post(c.edgeRoutes.pair, { bodyLimit: 4096, schema: { body: c.edgePairInput } }, async (req) => {
    const i = parse(c.edgePairInput, req.body, 'body'); await identityRateLimit(opts.owner, 'relay-pair:' + req.ip, 50);
    const principal = await acceptRelayPairing(opts.owner, opts.app, i.pairingToken, i.credentialSecret, (ctx, gateway, site) => liveGateway(ctx, gateway, site)); return sessionView(principal);
  });
  server.get(c.edgeRoutes.session, async (req) => withRelayRequest(opts, req, (ctx) => relayWork(ctx, async () => { await touchRelayPresence(ctx); return sessionView(await assertRelayCredential(ctx), ctx.now()); })));
  server.post(c.edgeRoutes.rotate, { bodyLimit: 4096, schema: { body: c.edgeRotateInput } }, async (req) => {
    const i = parse(c.edgeRotateInput, req.body, 'body');
    return withRelayRequest(opts, req, (ctx) => relayWork(ctx, async () => {
      await identityRateLimit(opts.owner, 'relay-rotate:' + ctx.tenantId + ':' + ctx.actor.id, 6, 3600);
      return sessionView(await rotateRelayCredential(ctx, i.rotationId, i.newCredentialSecret), ctx.now());
    }));
  });
  server.post(c.edgeRoutes.claim, { bodyLimit: 1024, schema: { body: empty } }, async (req) => withRelayRequest(opts, req, claimJob));
  server.post(c.edgeRoutes.start, { bodyLimit: 4096, schema: { body: c.edgeLease } }, async (req) => withRelayRequest(opts, req, (ctx) => startJob(ctx, parse(c.edgeLease, req.body, 'body'))));
  server.post(c.edgeRoutes.heartbeat, { bodyLimit: 4096, schema: { body: c.edgeLease } }, async (req) => withRelayRequest(opts, req, (ctx) => heartbeatJob(ctx, parse(c.edgeLease, req.body, 'body'))));
  server.post(c.edgeRoutes.complete, { bodyLimit: 8192, schema: { body: c.edgeCompleteInput } }, async (req) => withRelayRequest(opts, req, (ctx) => completeJob(ctx, parse(c.edgeCompleteInput, req.body, 'body'))));
  server.post(c.edgeRoutes.event, { bodyLimit: 4096, schema: { body: c.edgeEventInput } }, async (req) => withRelayRequest(opts, req, (ctx) => recordDeviceEvent(ctx, parse(c.edgeEventInput, req.body, 'body'))));
  server.post('/edge/pairings', { bodyLimit: 4096, schema: { body: c.edgePairingInput } }, async (req) => {
    const i = parse(c.edgePairingInput, req.body, 'body'); await identityRateLimit(opts.owner, 'relay-pair-issue:' + req.principal?.userId, 30);
    return withContext(opts.app, req.contextParams(), (ctx) => withRelayOperator(ctx, i.gatewayId, async (live) => { const g = await liveGateway(live, i.gatewayId); expected(g.version, i.expectedVersion); return issueRelayPairing(live, g.id, g.siteId, i.stepUpToken); }));
  });
  server.post('/edge/credentials/revoke', { bodyLimit: 4096, schema: { body: c.edgeRevokeInput } }, async (req) => {
    const i = parse(c.edgeRevokeInput, req.body, 'body');
    return withContext(opts.app, req.contextParams(), (ctx) => withRelayOperator(ctx, i.gatewayId, async (live) => { const g = await liveGateway(live, i.gatewayId, undefined, false); expected(g.version, i.expectedVersion); return revokeRelayCredentials(live, g.id, i.stepUpToken, i.reason); }));
  });
  await registerRelaySockets(server, opts);
}
