// Event delivery administration and the self-service inbox mail switch (docs/specs/event-delivery.md AC-14, AC-18..AC-20,
// AC-22; ADR-0037). Hand-written routes over kernel functions, like company administration: delivery rows, secrets and
// inbox watches are kernel tables, not entities. The kernel functions check access themselves (company admin with a
// user actor; the caller themself for /me/notifications).
//   GET  /admin/event-deliveries?status&limit&before   -> { items, counts, nextCursor }
//   POST /admin/event-deliveries/:id/retry             -> the row, back to pending with the same delivery id
//   GET  /admin/webhooks                               -> endpoints with secret states and this server's facts
//   POST /admin/webhooks/:endpointId/secret { url }    -> { endpointId, url, secret, issuedAt } once (no-store);
//                                                         409 when the endpoint's URL is no longer the one sent
//   GET  /me/notifications, PUT /me/notifications      -> { inboxEmail, available, reason? }
import {
  deliveryListQuerySchema,
  getInboxNotification,
  issueWebhookSecret,
  listEventDeliveries,
  retryEventDelivery,
  setInboxNotification,
  webhookEndpoints,
  type Database,
} from '@daifuku/kernel';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, withRequestContext } from '../request-context.ts';

export interface EventDeliveryRouteOptions {
  db: Database;
  /** The identity encryption key of this process (absent: secrets cannot be issued). */
  encryptionKey?: string;
  /** This process has an SMTP transport for inbox mail. */
  mailConfigured: boolean;
  /** EVENT_WORKER_ENABLED of this process. */
  workerEnabled: boolean;
}

const idParams = z.object({ id: z.string().min(1).max(100) });
const endpointParams = z.object({ endpointId: z.string().min(1).max(40) });
const notificationBody = z.object({ inboxEmail: z.boolean() }).strict();
/** The destination URL the administrator saw and confirmed (AC-14): the secret is issued only for that URL. */
const issueBody = z.object({ url: z.string().min(1).max(500) }).strict();

export function registerEventDeliveryRoutes(app: FastifyInstance, opts: EventDeliveryRouteOptions): void {
  const mail = { mailConfigured: opts.mailConfigured };
  app.get(
    '/admin/event-deliveries',
    {
      schema: {
        tags: ['access'],
        summary: 'Webhook, email and internal event deliveries of the company by status, newest first (company admins)',
        querystring: deliveryListQuerySchema,
      },
    },
    async (req) => {
      const query = parse(deliveryListQuerySchema, req.query, 'query');
      return withRequestContext(opts.db, req, (ctx) => listEventDeliveries(ctx, query));
    },
  );
  app.post(
    '/admin/event-deliveries/:id/retry',
    {
      schema: {
        tags: ['access'],
        summary: 'Resend a failed (dead) delivery with the same delivery id; audited (company admins)',
        params: idParams,
      },
    },
    async (req) => {
      const { id } = parse(idParams, req.params, 'params');
      return withRequestContext(opts.db, req, (ctx) => retryEventDelivery(ctx, id));
    },
  );
  app.get(
    '/admin/webhooks',
    {
      schema: {
        tags: ['access'],
        summary: 'Webhook endpoints with the state of each signing secret (never the secret) (company admins)',
      },
    },
    async (req) => {
      const view = await withRequestContext(opts.db, req, webhookEndpoints);
      return {
        ...view,
        secretsAvailable: Boolean(opts.encryptionKey),
        mailConfigured: opts.mailConfigured,
        worker: { enabledHere: opts.workerEnabled },
      };
    },
  );
  app.post(
    '/admin/webhooks/:endpointId/secret',
    {
      schema: {
        tags: ['access'],
        summary:
          'Issue (or reissue) the signing secret of one endpoint for the URL the admin confirmed; returned once (company admins, users only)',
        params: endpointParams,
        body: issueBody,
      },
    },
    async (req, reply) => {
      const { endpointId } = parse(endpointParams, req.params, 'params');
      const { url } = parse(issueBody, req.body, 'body');
      const issued = await withRequestContext(opts.db, req, (ctx) =>
        issueWebhookSecret(ctx, endpointId, { encryptionKey: opts.encryptionKey, expectedUrl: url }),
      );
      void reply.header('cache-control', 'no-store');
      return issued;
    },
  );
  app.get(
    '/me/notifications',
    { schema: { tags: ['auth'], summary: 'Your inbox mail setting in the current company' } },
    async (req) => withRequestContext(opts.db, req, (ctx) => getInboxNotification(ctx, mail)),
  );
  app.put(
    '/me/notifications',
    {
      schema: {
        tags: ['auth'],
        summary: 'Turn your inbox mail on or off in the current company (on needs the company switch and SMTP)',
        body: notificationBody,
      },
    },
    async (req) => {
      const { inboxEmail } = parse(notificationBody, req.body, 'body');
      return withRequestContext(opts.db, req, (ctx) => setInboxNotification(ctx, inboxEmail, mail));
    },
  );
}
