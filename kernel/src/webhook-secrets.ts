// Webhook signing secrets (docs/specs/event-delivery.md AC-14, AC-19, AC-22; ADR-0037). An administrator has the server
// generate a secret per endpoint; it is returned once and stored only as AES-256-GCM ciphertext under the identity
// encryption key, bound to the endpoint URL's hash. Issuing is the activation: events created before the first issue for
// a URL are not sent there, and a URL change makes the secret invalid until it is reissued.
import { randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { writeAudit } from './audit.ts';
import type { Context } from './context.ts';
import { webhookSecrets } from './db/event-tables.ts';
import { users } from './db/system-tables.ts';
import { NotFound, StateError } from './errors.ts';
import { seal } from './identity/crypto.ts';
import { assertEventAdmin, webhookSecretPurpose } from './event-delivery.ts';
import { integrationWebhooksOf, webhookUrlHash } from './integration-settings.ts';
import { getCompany, lockedCompanySettings } from './settings.ts';

export type WebhookSecretState = 'none' | 'active' | 'reissue_required';

export interface WebhookEndpointView {
  id: string;
  label: string;
  url: string;
  topics: string[];
  enabled: boolean;
  secret: { state: WebhookSecretState; issuedAt?: string; issuedByName?: string };
}

export interface WebhookEndpointsView {
  endpoints: WebhookEndpointView[];
  inboxEmail: boolean;
  /** False when the stored setting no longer matches its schema (it then routes to no endpoint). */
  settingValid: boolean;
}

/** The company's endpoints with the state of each signing secret (never the secret). Company administrators only. */
export async function webhookEndpoints(ctx: Context): Promise<WebhookEndpointsView> {
  assertEventAdmin(ctx, 'read');
  const company = await getCompany(ctx);
  const { value, valid } = integrationWebhooksOf(company.settings);
  const rows =
    value.endpoints.length === 0
      ? []
      : await ctx.db
          .select({
            endpointId: webhookSecrets.endpointId,
            urlHash: webhookSecrets.urlHash,
            issuedAt: webhookSecrets.issuedAt,
            issuedBy: webhookSecrets.issuedBy,
          })
          .from(webhookSecrets)
          .where(
            and(
              eq(webhookSecrets.tenantId, ctx.tenantId),
              eq(webhookSecrets.companyId, company.id),
              inArray(
                webhookSecrets.endpointId,
                value.endpoints.map((e) => e.id),
              ),
            ),
          );
  const issuerIds = [...new Set(rows.map((r) => r.issuedBy))];
  const names = new Map<string, string>();
  if (issuerIds.length > 0) {
    const people = await ctx.db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.tenantId, ctx.tenantId), inArray(users.id, issuerIds)));
    for (const p of people) names.set(p.id, p.name);
  }
  return {
    inboxEmail: value.inboxEmail,
    settingValid: valid,
    endpoints: value.endpoints.map((endpoint) => {
      const row = rows.find((r) => r.endpointId === endpoint.id);
      const secret: WebhookEndpointView['secret'] = row
        ? {
            state: row.urlHash === webhookUrlHash(endpoint.url) ? 'active' : 'reissue_required',
            issuedAt: row.issuedAt.toISOString(),
          }
        : { state: 'none' };
      const issuedByName = row ? names.get(row.issuedBy) : undefined;
      if (issuedByName) secret.issuedByName = issuedByName;
      return {
        id: endpoint.id,
        label: endpoint.label,
        url: endpoint.url,
        topics: [...endpoint.topics],
        enabled: endpoint.enabled,
        secret,
      };
    }),
  };
}

export interface IssuedWebhookSecret {
  endpointId: string;
  /** The destination the secret is bound to (the URL the administrator confirmed). */
  url: string;
  /** Shown once; never stored or returned again. */
  secret: string;
  issuedAt: string;
}

/**
 * Generates and stores a new signing secret for one endpoint (AC-14), replacing the previous one. Issuing activates the
 * endpoint, so it is bound to the URL the administrator saw: `expectedUrl` must equal the endpoint's URL read under the
 * company row lock (the lock setSetting takes), otherwise 409 and nothing changes, so a settings-role user cannot swap the
 * destination between the administrator's view and the click. The activation time is kept when the URL is unchanged
 * (reissue) and set to now otherwise. Audited as `webhook_secret` op `issue` with the endpoint id and host only. 409
 * without an encryption key; 404 for an endpoint the company setting does not have.
 */
export async function issueWebhookSecret(
  ctx: Context,
  endpointId: string,
  opts: { encryptionKey: string | undefined; expectedUrl: string },
): Promise<IssuedWebhookSecret> {
  assertEventAdmin(ctx, 'issue');
  if (!opts.encryptionKey)
    throw new StateError(
      'webhook signing secrets need the identity encryption key on this server',
      'Ask the operator to configure IDENTITY_ENCRYPTION_KEY and PUBLIC_WEB_URL (see the deployment guide), then retry.',
    );
  const company = await lockedCompanySettings(ctx);
  const endpoint = integrationWebhooksOf(company.settings).value.endpoints.find((e) => e.id === endpointId);
  if (!endpoint) throw new NotFound('webhook_endpoint', endpointId);
  if (endpoint.url !== opts.expectedUrl)
    throw new StateError(
      'the destination URL of this endpoint changed after it was shown',
      'Reload the screen, check the destination URL, then issue the signing secret again.',
      { endpointId: endpoint.id, reason: 'url_changed' },
    );
  const now = ctx.now();
  const urlHash = webhookUrlHash(endpoint.url);
  const key = and(
    eq(webhookSecrets.tenantId, ctx.tenantId),
    eq(webhookSecrets.companyId, company.id),
    eq(webhookSecrets.endpointId, endpoint.id),
  );
  const [existing] = await ctx.db
    .select({ urlHash: webhookSecrets.urlHash, activatedAt: webhookSecrets.activatedAt })
    .from(webhookSecrets)
    .where(key)
    .limit(1)
    .for('update');
  const secret = `whsec_${randomBytes(32).toString('base64url')}`;
  const values = {
    secretCipher: seal(secret, opts.encryptionKey, webhookSecretPurpose(ctx.tenantId, company.id, endpoint.id)),
    urlHash,
    issuedAt: now,
    activatedAt: existing && existing.urlHash === urlHash ? existing.activatedAt : now,
    issuedBy: ctx.actor.id,
  };
  if (existing) await ctx.db.update(webhookSecrets).set(values).where(key);
  else
    await ctx.db
      .insert(webhookSecrets)
      .values({ tenantId: ctx.tenantId, companyId: company.id, endpointId: endpoint.id, ...values });
  await writeAudit(ctx, 'webhook_secret', company.id, 'issue', null, {
    endpointId: endpoint.id,
    host: new URL(endpoint.url).hostname,
  });
  return { endpointId: endpoint.id, url: endpoint.url, secret, issuedAt: now.toISOString() };
}
