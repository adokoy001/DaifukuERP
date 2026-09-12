import { beginMfa, changeMfa, PermissionDenied, completeIdentityToken, completeMfaLogin, confirmMfa, identityRateLimit, identitySecurity, inviteIdentity, requestIdentityReset, stepUpIdentity, withContext } from '@daifuku/kernel';
import type { FastifyInstance } from 'fastify';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { parse } from '../request-context.ts';
import { configured, currentIdentity, identityLoginReply, type IdentityRouteOptions } from './session.ts';
import { registerOidcRoutes } from './routes-oidc.ts';
import { verifyAttempt } from './attempt.ts';
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/), code = z.string().min(1).max(64), password = z.string().min(12).max(200);
const step = z.object({ stepUpToken: token }).strict();
export function registerIdentityRoutes(app: FastifyInstance, options: IdentityRouteOptions): void {
  registerOidcRoutes(app, options);
  app.get('/auth/security', async (req) => ({ ...await withContext(options.db, req.contextParams(), (ctx) => identitySecurity(ctx, currentIdentity(req).sessionVersion)), configured: Boolean(options.identity) }));
  app.post('/auth/step-up', async (req) => {
    const input = parse(z.object({ currentPassword: z.string().min(1).max(200), code: code.optional() }).strict(), req.body, 'body'), config = configured(options), current = currentIdentity(req);
    return verifyAttempt(options.owner, req, 'stepup', () => withContext(options.db, req.contextParams(), (ctx) => stepUpIdentity(ctx, current.sessionVersion, input.currentPassword, input.code, config.encryptionKey)), current.userId);
  });
  app.post('/auth/mfa/setup', async (req) => {
    const input = parse(step, req.body, 'body'), config = configured(options);
    return withContext(options.db, req.contextParams(), (ctx) => beginMfa(ctx, currentIdentity(req).sessionVersion, input.stepUpToken, config.encryptionKey));
  });
  app.post('/auth/mfa/confirm', async (req) => {
    const input = parse(z.object({ setupToken: token, code }).strict(), req.body, 'body');
    return verifyAttempt(options.owner, req, 'mfa-confirm', () => confirmMfa(options.owner, currentIdentity(req), input.setupToken, input.code, configured(options).encryptionKey), currentIdentity(req).userId);
  });
  for (const [path, mode] of [['disable', 'disable'], ['recovery-codes', 'recovery']] as const) app.post(`/auth/mfa/${path}`, async (req) => {
    const input = parse(step, req.body, 'body');
    return withContext(options.db, req.contextParams(), (ctx) => changeMfa(ctx, currentIdentity(req).sessionVersion, input.stepUpToken, mode));
  });
  app.post('/auth/mfa/verify', async (req) => {
    const input = parse(z.object({ challengeToken: token, code }).strict(), req.body, 'body');
    return verifyAttempt(options.owner, req, 'mfa-login', async () => {
      const identity = await completeMfaLogin(options.owner, input.challengeToken, input.code, configured(options).encryptionKey);
      return identityLoginReply(app, options, identity, true);
    });
  });
  app.post('/auth/password-reset/request', async (req) => {
    const input = parse(z.object({ email: z.email().max(200), tenantId: z.uuid().optional() }).strict(), req.body, 'body'), started = Date.now();
    await identityRateLimit(options.owner, `reset-ip:${req.ip}`, 20, 1800);
    await identityRateLimit(options.owner, `reset:${input.tenantId ?? ''}:${input.email.toLowerCase()}`, 3, 1800);
    try { if (options.identity) await requestIdentityReset(options.owner, input.email, input.tenantId, { ...options.identity, mailConfigured: Boolean(options.identity.mailTransport) }); }
    catch { /* Same response for an inactive/raced/unknown identity; do not disclose its state. */ }
    finally { await setTimeout(Math.max(0, 250 - (Date.now() - started))); }
    return { ok: true };
  });
  for (const [path, purpose] of [['password-reset/complete', 'password_reset'], ['invitations/accept', 'invitation']] as const) app.post(`/auth/${path}`, async (req) => {
    const input = parse(z.object({ token, newPassword: password }).strict(), req.body, 'body');
    return verifyAttempt(options.owner, req, purpose, () => completeIdentityToken(options.owner, input.token, purpose, input.newPassword));
  });
  app.post('/auth/invitations', async (req) => {
    const input = parse(z.object({ email: z.email().max(200), name: z.string().trim().min(1).max(200), stepUpToken: token }).strict(), req.body, 'body'), config = configured(options);
    const current = currentIdentity(req);
    if (!req.principal?.tenantAdmin) throw new PermissionDenied('identity', 'invite', req.principal?.roles ?? []);
    await identityRateLimit(options.owner, `invite-user:${current.tenantId}:${current.userId}`, 30);
    await identityRateLimit(options.owner, `invite-tenant:${current.tenantId}`, 100);
    return withContext(options.db, req.contextParams(), (ctx) => inviteIdentity(ctx, current.sessionVersion, input, { ...config, mailConfigured: Boolean(config.mailTransport) }));
  });
}
