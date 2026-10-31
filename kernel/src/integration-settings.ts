// The kernel-owned company setting `integration.webhooks` (docs/specs/event-delivery.md AC-13, AC-15; ADR-0027 append,
// ADR-0037): the company's webhook endpoints (id, label, URL, subscribed topics, enabled) and the company switch for
// inbox mail. The value never holds a secret: the schema is strict, and signing secrets live encrypted in
// webhook_secrets (webhook-secrets.ts). An endpoint URL is not a secret either (settings-role users and the audit trail
// see it); receivers authenticate deliveries by Daifuku-Signature.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { label } from './i18n.ts';
import { registry, type SettingDef } from './registry.ts';

export const INTEGRATION_WEBHOOKS_KEY = 'integration.webhooks';
export const MAX_WEBHOOK_ENDPOINTS = 10;
export const WEBHOOK_ENDPOINT_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/** `<entity>.<event>` or `<prefix>.*`. */
export const WEBHOOK_TOPIC = /^[a-z][a-z0-9_]*\.([a-z][a-z0-9_]*|\*)$/;
/** Topics of the per-user inbox notification: mail to the user only, never to webhooks in this item (AC-6 (e)). */
export const INBOX_TOPIC_PREFIX = 'inbox.';

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

/** True for the development/test form (b) of AC-13: an http(s) URL whose host is 127.0.0.1, localhost or [::1]. */
export function isLoopbackWebhookUrl(url: URL): boolean {
  return LOOPBACK_HOSTS.includes(url.hostname.toLowerCase());
}

/**
 * Why a URL may not be stored as an endpoint (AC-13), or null when it may: (a) an https URL with a DNS host name (no IP
 * literal, no `localhost`, a dot in the name, not `.local` / `.internal` / `.localhost`), or (b) a loopback URL. Neither
 * may carry user info or a fragment, and the text is at most 500 characters.
 */
export function webhookUrlProblem(value: string): string | null {
  if (value.length > 500) return 'at most 500 characters';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'not a URL';
  }
  if (url.username || url.password) return 'user info is not allowed';
  if (url.hash || value.includes('#')) return 'a fragment is not allowed';
  if (isLoopbackWebhookUrl(url)) return url.protocol === 'http:' || url.protocol === 'https:' ? null : 'http(s) only';
  if (url.protocol !== 'https:') return 'https is required';
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    host === '' ||
    /^\d+(\.\d+){3}$/.test(host) ||
    host.includes(':') ||
    host.startsWith('[') ||
    !host.includes('.') ||
    /\.(local|internal|localhost)$/.test(host)
  )
    return 'the host must be a public DNS name';
  return null;
}

/** Exact match, or `<prefix>.*` matching every topic of that prefix. */
export function topicMatches(pattern: string, topic: string): boolean {
  if (pattern.endsWith('.*')) return topic.startsWith(pattern.slice(0, -1)) && topic.length > pattern.length - 1;
  return pattern === topic;
}

/** SHA-256 (hex) of an endpoint URL: binds a signing secret and a routed delivery to the URL the admin approved. */
export function webhookUrlHash(url: string): string {
  return createHash('sha256').update(url, 'utf8').digest('hex');
}

export const webhookEndpointSchema = z
  .object({
    id: z.string().regex(WEBHOOK_ENDPOINT_ID, 'lowercase letters, digits, _ and -, up to 40 characters'),
    label: z.string().trim().min(1).max(80),
    url: z
      .string()
      .max(500)
      .refine((value) => webhookUrlProblem(value) === null, {
        message: 'an https URL with a public DNS host (or a loopback URL for development), without user info or #',
      }),
    topics: z
      .array(
        z
          .string()
          .regex(WEBHOOK_TOPIC, 'a topic such as sales_invoice.submitted or sales_invoice.*')
          .refine((topic) => !topic.startsWith(INBOX_TOPIC_PREFIX), {
            message: 'inbox topics are sent by mail only, not to webhooks',
          }),
      )
      .min(1)
      .max(50),
    enabled: z.boolean().default(true),
  })
  .strict();
export type WebhookEndpoint = z.output<typeof webhookEndpointSchema>;

export const integrationWebhooksSchema = z
  .object({
    endpoints: z.array(webhookEndpointSchema).max(MAX_WEBHOOK_ENDPOINTS),
    inboxEmail: z.boolean(),
  })
  .strict()
  .superRefine((value, issues) => {
    const seen = new Set<string>();
    value.endpoints.forEach((endpoint, index) => {
      if (seen.has(endpoint.id))
        issues.addIssue({ code: 'custom', path: ['endpoints', index, 'id'], message: 'endpoint ids must be unique' });
      seen.add(endpoint.id);
    });
  });
export type IntegrationWebhooks = z.output<typeof integrationWebhooksSchema>;

export const DEFAULT_INTEGRATION_WEBHOOKS: IntegrationWebhooks = { endpoints: [], inboxEmail: false };

const ENDPOINT_EXAMPLE =
  '{"id":"accounting","label":"会計連携","url":"https://hooks.example.com/daifuku","topics":["sales_invoice.submitted","sales_invoice.*"],"enabled":true}';

export const INTEGRATION_WEBHOOKS_SETTING: SettingDef<IntegrationWebhooks> = {
  key: INTEGRATION_WEBHOOKS_KEY,
  label: label('外部連携（Webhook・通知）', 'Integrations (webhooks and notifications)'),
  description: label(
    '確定した伝票などの業務イベントを外部システムへ署名付きで送る送信先と、受信箱のメール通知の会社スイッチ。送信先の署名鍵は「イベント配送」画面で管理者が発行する',
    'Destinations that receive signed business events (submitted documents and more), and the company switch for inbox mail. An administrator issues each destination’s signing secret on the Event deliveries screen',
  ),
  schema: integrationWebhooksSchema,
  default: DEFAULT_INTEGRATION_WEBHOOKS,
  category: 'integration',
  order: 0,
  fields: {
    endpoints: {
      label: label('送信先（Webhook）', 'Destinations (webhooks)'),
      description: label(
        `最大 10 件。1 件の形: ${ENDPOINT_EXAMPLE}。id は英小文字・数字・_・-、topic は「伝票.submitted」のような名前か「伝票.*」。URL は https の公開ホスト名（開発では http://127.0.0.1 など）。URL は秘密ではありません（設定の履歴に残ります）。受信側は URL の中の token ではなく署名で送信元を確かめてください。URL を変えると管理者が署名鍵を再発行するまで送りません`,
        `Up to 10. One destination looks like: ${ENDPOINT_EXAMPLE}. The id uses lowercase letters, digits, _ and -; a topic is a name such as "sales_invoice.submitted" or "sales_invoice.*". The URL is https with a public host name (http://127.0.0.1 and similar in development). The URL is not a secret (it stays in the setting history): receivers should verify the signature, not a token in the URL. After a URL change nothing is sent until an administrator reissues the signing secret`,
      ),
    },
    inboxEmail: {
      label: label('受信箱のメール通知を許可する', 'Allow inbox mail'),
      description: label(
        'オンにすると、利用者が受信箱の画面で「件数が増えたらメールで知らせる」を選べる（メール送信の設定が必要）',
        'When on, users can choose “Email me when my to-dos increase” on the inbox screen (mail delivery must be configured)',
      ),
    },
  },
};

/** Declares `integration.webhooks` once (idempotent; also after registry.reset in tests). apps/runtime calls it. */
export function ensureIntegrationSettings(): void {
  if (!registry.hasSetting(INTEGRATION_WEBHOOKS_KEY)) registry.registerSetting(INTEGRATION_WEBHOOKS_SETTING);
}

/**
 * The setting in raw company settings. Unset reads as the default; a stored value that no longer matches the schema
 * reads as the default with `valid: false` (callers log a warning and route to no endpoint).
 */
export function integrationWebhooksOf(settings: Readonly<Record<string, unknown>>): {
  value: IntegrationWebhooks;
  valid: boolean;
} {
  const raw = settings[INTEGRATION_WEBHOOKS_KEY];
  if (raw === undefined) return { value: DEFAULT_INTEGRATION_WEBHOOKS, valid: true };
  const parsed = integrationWebhooksSchema.safeParse(raw);
  return parsed.success ? { value: parsed.data, valid: true } : { value: DEFAULT_INTEGRATION_WEBHOOKS, valid: false };
}
