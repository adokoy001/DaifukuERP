// Pure helpers of /admin/event-deliveries and the inbox mail switch (docs/specs/event-delivery.md AC-18, AC-19,
// AC-25..AC-27): the tabs and their `?status=` value, each status as a colour tone and a word, the bilingual
// explanation of every classification code, the signing secret state and the reason a switch is unavailable.
import type { Label } from '../api/types.ts';

export const DELIVERY_TABS = ['dead', 'pending', 'cancelled', 'delivered'] as const;
export type DeliveryTab = (typeof DELIVERY_TABS)[number];
export type DeliveryStatus = 'pending' | 'sending' | 'delivered' | 'dead' | 'cancelled';
export type DeliveryKind = 'webhook' | 'email' | 'internal';

export interface DeliveryItem {
  id: string;
  kind: DeliveryKind;
  target: { endpointId?: string; endpointLabel?: string; userName?: string };
  topic: string;
  eventId: string;
  status: DeliveryStatus;
  attempts: number;
  lastError: string | null;
  lastStatus?: number;
  createdAt: string;
  nextAttemptAt?: string;
  deliveredAt?: string;
  deadAt?: string;
  cancelledAt?: string;
}
export interface DeliveryList {
  items: DeliveryItem[];
  counts: Record<DeliveryTab, number>;
  nextCursor: string | null;
}
export type SecretState = 'none' | 'active' | 'reissue_required';
export interface WebhookEndpointView {
  id: string;
  label: string;
  url: string;
  topics: string[];
  enabled: boolean;
  secret: { state: SecretState; issuedAt?: string; issuedByName?: string };
}
export interface WebhooksView {
  endpoints: WebhookEndpointView[];
  inboxEmail: boolean;
  settingValid: boolean;
  secretsAvailable: boolean;
  mailConfigured: boolean;
  worker: { enabledHere: boolean };
}
export interface IssuedSecret {
  endpointId: string;
  secret: string;
  issuedAt: string;
}
export interface InboxNotification {
  inboxEmail: boolean;
  available: boolean;
  reason?: 'company_disabled' | 'mail_not_configured';
}

/** `?status=` of the screen: one of the tabs; anything else (or nothing) means the default, failed deliveries. */
export function parseDeliveriesSearch(raw: Record<string, unknown>): { status?: DeliveryTab } {
  const value = raw.status;
  return typeof value === 'string' && (DELIVERY_TABS as readonly string[]).includes(value)
    ? { status: value as DeliveryTab }
    : {};
}

export function selectedTab(search: { status?: DeliveryTab }): DeliveryTab {
  return search.status ?? 'dead';
}

export const TAB_TEXT: Record<DeliveryTab, Label> = {
  dead: { ja: '失敗', en: 'Failed' },
  pending: { ja: '送信待ち', en: 'Waiting' },
  cancelled: { ja: '取消', en: 'Cancelled' },
  delivered: { ja: '送信済み', en: 'Delivered' },
};

export function tabLabel(tab: DeliveryTab, counts: Partial<Record<DeliveryTab, number>> | undefined): Label {
  const n = counts?.[tab];
  if (n === undefined) return TAB_TEXT[tab];
  return { ja: `${TAB_TEXT[tab].ja}（${n}）`, en: `${TAB_TEXT[tab].en} (${n})` };
}

export const STATUS_TEXT: Record<DeliveryStatus, Label> = {
  dead: { ja: '失敗', en: 'Failed' },
  pending: { ja: '送信待ち', en: 'Waiting' },
  sending: { ja: '送信中', en: 'Sending' },
  cancelled: { ja: '取消', en: 'Cancelled' },
  delivered: { ja: '送信済み', en: 'Delivered' },
};
export const STATUS_TONE: Record<DeliveryStatus, 'danger' | 'warning' | 'accent' | 'neutral' | 'success'> = {
  dead: 'danger',
  pending: 'warning',
  sending: 'accent',
  cancelled: 'neutral',
  delivered: 'success',
};

export const KIND_TEXT: Record<DeliveryKind, Label> = {
  webhook: { ja: 'Webhook', en: 'Webhook' },
  email: { ja: 'メール', en: 'Email' },
  internal: { ja: '社内の処理', en: 'Internal' },
};

const CODE_TEXT: Readonly<Record<string, Label>> = {
  timeout: { ja: '10 秒以内に応答がありませんでした', en: 'No response within 10 seconds' },
  network: {
    ja: '接続できませんでした（名前解決・接続の失敗）',
    en: 'Could not connect (name lookup or connection failed)',
  },
  tls: { ja: 'TLS 証明書を検証できませんでした', en: 'The TLS certificate could not be verified' },
  redirect: {
    ja: '転送（3xx）が返りました。転送先は追いません',
    en: 'The receiver redirected (3xx); redirects are not followed',
  },
  http_status: { ja: '受信側がエラーの状態コードを返しました', en: 'The receiver returned an error status' },
  blocked_destination: {
    ja: '送信先のアドレスが許可されていません（内部・予約済みのアドレス）',
    en: 'The destination address is not allowed (internal or reserved address)',
  },
  secret_unreadable: {
    ja: '署名鍵を復号できません。署名鍵を再発行してください',
    en: 'The signing secret cannot be decrypted. Reissue the secret',
  },
  payload_too_large: { ja: '本文が 256 KiB を超えるため送れません', en: 'The body is larger than 256 KiB' },
  lease_expired: {
    ja: '送信中に処理が止まり、試行の上限に達しました',
    en: 'Sending stopped part-way and the attempt limit was reached',
  },
  mail_failed: { ja: 'メールを送れませんでした', en: 'The email could not be sent' },
  subscriber_failed: { ja: '社内の処理が失敗しました', en: 'An internal subscriber failed' },
  endpoint_removed: { ja: '送信先が設定から削除されました', en: 'The destination was removed from the settings' },
  endpoint_disabled: { ja: '送信先が無効になりました', en: 'The destination was disabled' },
  endpoint_changed: {
    ja: '送信先の URL が変わりました（署名鍵の再発行が必要です）',
    en: 'The destination URL changed (the signing secret must be reissued)',
  },
  topic_unsubscribed: {
    ja: '送信先がこの種類のイベントを購読しなくなりました',
    en: 'The destination no longer subscribes to this event type',
  },
  recipient_inactive: {
    ja: '宛先の利用者が無効か、会社に所属していません',
    en: 'The recipient is inactive or no longer a member of the company',
  },
  notification_off: {
    ja: '宛先の利用者または会社がメール通知を止めました',
    en: 'The recipient or the company turned inbox mail off',
  },
};

/**
 * The explanation of a row's last error. Delivery rows carry a classification code; internal rows carry a safe
 * diagnostic (an error code, or INTERNAL with a SQLSTATE), shown after the generic explanation.
 */
export function errorText(item: Pick<DeliveryItem, 'kind' | 'lastError' | 'lastStatus'>): Label | null {
  const code = item.lastError;
  if (!code) return null;
  const known = CODE_TEXT[code];
  if (known && item.kind !== 'internal') {
    if (code === 'http_status' && item.lastStatus)
      return { ja: `${known.ja}（${item.lastStatus}）`, en: `${known.en} (${item.lastStatus})` };
    return known;
  }
  const generic = CODE_TEXT.subscriber_failed as Label;
  return { ja: `${generic.ja}（${code}）`, en: `${generic.en} (${code})` };
}

export function targetText(item: Pick<DeliveryItem, 'kind' | 'target'>): Label {
  if (item.kind === 'webhook') {
    const name = item.target.endpointLabel ?? item.target.endpointId ?? '';
    return item.target.endpointLabel ? { ja: name, en: name } : { ja: `${name}（削除済み）`, en: `${name} (removed)` };
  }
  if (item.kind === 'email') {
    const name = item.target.userName;
    return name ? { ja: name, en: name } : { ja: '（不明な利用者）', en: '(unknown user)' };
  }
  return { ja: '社内の購読者', en: 'Internal subscribers' };
}

export function secretStateText(secret: WebhookEndpointView['secret'], formatDate: (iso: string) => string): Label {
  if (secret.state === 'none') return { ja: '署名鍵: 未発行', en: 'Signing secret: not issued' };
  if (secret.state === 'reissue_required')
    return {
      ja: '署名鍵: URL が変わったため再発行が必要です（送信を止めています）',
      en: 'Signing secret: the URL changed, so it must be reissued (sending is paused)',
    };
  const when = secret.issuedAt ? formatDate(secret.issuedAt) : '';
  const who = secret.issuedByName ?? '';
  return {
    ja: `署名鍵: 発行済み（${when}${who ? `、${who}` : ''}）`,
    en: `Signing secret: issued (${when}${who ? `, ${who}` : ''})`,
  };
}

export const SECRET_TONE: Record<SecretState, 'neutral' | 'success' | 'warning'> = {
  none: 'neutral',
  active: 'success',
  reissue_required: 'warning',
};

/** Why the inbox mail switch cannot be turned on (AC-26), or null when it can. */
export function notificationReason(value: InboxNotification | undefined): Label | null {
  if (!value || value.available) return null;
  return value.reason === 'company_disabled'
    ? { ja: '会社でメール通知が有効になっていません', en: 'Inbox mail is not enabled for this company' }
    : { ja: 'メール送信が設定されていません', en: 'Mail delivery is not configured' };
}

/** Company administrators see the delivery screen in the navigation (AC-27; the API also checks company-wide access). */
export function isCompanyAdmin(roles: readonly string[] | undefined): boolean {
  return roles?.includes('admin') ?? false;
}
