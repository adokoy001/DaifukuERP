import {
  consumeStepUp,
  identityDenied,
  identityRateLimit,
  issueChallenge,
  linkedIdentity,
  linkIdentity,
  lockIdentity,
  seal,
  unlinkIdentity,
  unseal,
  useChallenge,
  withContext,
} from '@daifuku/kernel';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse } from '../request-context.ts';
import { authorizationRequest, exchangeOidc, type OidcTransaction } from './oidc.ts';
import { verifyAttempt } from './attempt.ts';
import { configured, currentIdentity, identityLoginReply, type IdentityRouteOptions } from './session.ts';
const browser = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const providerId = z.string().regex(/^[a-z0-9_-]{1,40}$/);
export function registerOidcRoutes(app: FastifyInstance, options: IdentityRouteOptions): void {
  app.get('/auth/oidc/providers', async () => ({
    items: options.identity?.providers.map(({ id, label }) => ({ id, label })) ?? [],
  }));
  async function start(req: FastifyRequest, linking: boolean) {
    const input = parse(
      z.object({ providerId, browserNonce: browser, ...(linking ? { stepUpToken: browser } : {}) }).strict(),
      req.body,
      'body',
    );
    const config = configured(options);
    const provider = config.providers.find((p) => p.id === input.providerId);
    if (!provider) throw identityDenied();
    await identityRateLimit(options.owner, `oidc-start:${req.ip}`, 300);
    const current = linking ? currentIdentity(req) : undefined;
    if (current && current.tenantId !== provider.tenantId) throw identityDenied();
    return withContext(
      linking ? options.db : options.owner,
      {
        tenantId: provider.tenantId,
        companyId: null,
        actor: { type: 'user', id: current?.userId ?? 'oidc-start' },
        roles: [],
      },
      async (ctx) => {
        if (current) {
          await lockIdentity(ctx, current.sessionVersion);
          await consumeStepUp(ctx, String(input.stepUpToken), current.sessionVersion);
        }
        const request = authorizationRequest(provider, config, '', input.browserNonce, linking);
        const state = await issueChallenge(
          ctx,
          'oidc',
          current?.userId ?? null,
          {
            transactionCipher: seal(
              JSON.stringify(request.transaction),
              config.encryptionKey,
              `${provider.tenantId}:oidc`,
            ),
            ...(current ? { sessionVersion: current.sessionVersion } : {}),
          },
          600,
        );
        const url = new URL(request.authorizationUrl);
        url.searchParams.set('state', state);
        return { authorizationUrl: url.toString() };
      },
    );
  }
  app.post('/auth/oidc/start', (req) => start(req, false));
  app.post('/auth/oidc/link', (req) => start(req, true));
  app.post('/auth/oidc/complete', async (req) => {
    const input = parse(
      z.object({ providerId, state: browser, code: z.string().min(1).max(4096), browserNonce: browser }).strict(),
      req.body,
      'body',
    );
    const config = configured(options);
    const provider = config.providers.find((p) => p.id === input.providerId);
    if (!provider) throw identityDenied();
    const result = await verifyAttempt(options.owner, req, 'oidc-complete', () =>
      useChallenge(options.owner, input.state, 'oidc', async (ctx, challenge) => {
        if (ctx.tenantId !== provider.tenantId || typeof challenge.payload.transactionCipher !== 'string')
          throw identityDenied();
        const transaction = JSON.parse(
          unseal(challenge.payload.transactionCipher, config.encryptionKey, `${ctx.tenantId}:oidc`),
        ) as OidcTransaction;
        const subject = await exchangeOidc(provider, transaction, input.code, input.browserNonce, challenge.createdAt);
        if (transaction.linking) {
          if (!challenge.userId || typeof challenge.payload.sessionVersion !== 'number') throw identityDenied();
          return linkIdentity(ctx, provider, subject, challenge.payload.sessionVersion);
        }
        return linkedIdentity(ctx, provider, subject);
      }),
    );
    return 'linked' in result ? result : identityLoginReply(app, options, result);
  });
  app.post('/auth/oidc/unlink', async (req) => {
    const input = parse(z.object({ providerId, stepUpToken: browser }).strict(), req.body, 'body');
    return withContext(options.db, req.contextParams(), (ctx) =>
      unlinkIdentity(ctx, currentIdentity(req).sessionVersion, input.providerId, input.stepUpToken),
    );
  });
}
