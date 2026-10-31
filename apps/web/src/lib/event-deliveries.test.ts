// docs/specs/event-delivery.md AC-25..AC-27: tabs and `?status=`, status words and tones, classification codes in both
// languages, secret states and the inbox mail reasons.
import { describe, expect, it } from 'vitest';
import {
  DELIVERY_TABS,
  errorText,
  isCompanyAdmin,
  notificationReason,
  parseDeliveriesSearch,
  SECRET_STATE_TEXT,
  secretStateDetail,
  selectedTab,
  STATUS_TEXT,
  STATUS_TONE,
  tabLabel,
  targetText,
} from './event-deliveries.ts';

describe('event delivery screen helpers', () => {
  it('AC-25 ?status= keeps a known tab; anything else means the default failed tab', () => {
    for (const tab of DELIVERY_TABS) expect(parseDeliveriesSearch({ status: tab })).toEqual({ status: tab });
    expect(parseDeliveriesSearch({ status: 'sending' })).toEqual({});
    expect(parseDeliveriesSearch({ status: ['dead'] })).toEqual({});
    expect(parseDeliveriesSearch({})).toEqual({});
    expect(selectedTab({})).toBe('dead');
    expect(selectedTab({ status: 'delivered' })).toBe('delivered');
    expect(tabLabel('dead', { dead: 3, pending: 0, cancelled: 0, delivered: 0 })).toEqual({
      ja: '失敗（3）',
      en: 'Failed (3)',
    });
    expect(tabLabel('pending', undefined)).toEqual({ ja: '送信待ち', en: 'Waiting' });
  });

  it('AC-27 every status has a word in both languages and a distinct tone (colour and text)', () => {
    for (const status of ['pending', 'sending', 'delivered', 'dead', 'cancelled'] as const) {
      expect(STATUS_TEXT[status].ja).not.toBe('');
      expect(STATUS_TEXT[status].en).not.toBe('');
    }
    expect(new Set(Object.values(STATUS_TONE)).size).toBe(5);
  });

  it('AC-25 explains every classification code in Japanese and English; internal rows show their safe diagnostic', () => {
    const codes = [
      'timeout',
      'network',
      'tls',
      'redirect',
      'http_status',
      'blocked_destination',
      'secret_unreadable',
      'payload_too_large',
      'lease_expired',
      'mail_failed',
      'endpoint_removed',
      'endpoint_disabled',
      'endpoint_changed',
      'topic_unsubscribed',
      'recipient_inactive',
      'notification_off',
    ];
    const seen = new Set<string>();
    for (const code of codes) {
      const text = errorText({ kind: 'webhook', lastError: code });
      expect(text?.ja, code).toBeTruthy();
      expect(text?.en, code).toBeTruthy();
      expect(text?.ja).not.toContain(code);
      seen.add(text?.en ?? '');
    }
    expect(seen.size).toBe(codes.length);
    expect(errorText({ kind: 'webhook', lastError: 'http_status', lastStatus: 503 })?.ja).toContain('503');
    expect(errorText({ kind: 'internal', lastError: 'INTERNAL (SQLSTATE 23505)' })).toEqual({
      ja: '社内の処理が失敗しました（INTERNAL (SQLSTATE 23505)）',
      en: 'An internal subscriber failed (INTERNAL (SQLSTATE 23505))',
    });
    expect(errorText({ kind: 'email', lastError: null })).toBeNull();
  });

  it('AC-25 destination and secret state texts', () => {
    expect(targetText({ kind: 'webhook', target: { endpointId: 'acct', endpointLabel: '会計' } })).toEqual({
      ja: '会計',
      en: '会計',
    });
    expect(targetText({ kind: 'webhook', target: { endpointId: 'gone' } }).en).toBe('gone (removed)');
    expect(targetText({ kind: 'email', target: { userName: '山田' } }).ja).toBe('山田');
    expect(targetText({ kind: 'internal', target: {} }).en).toBe('Internal subscribers');
    const date = (iso: string) => iso.slice(0, 10);
    // The Badge carries a short word; the explanation is a wrapping line (AC-25 (b), AC-27 at 390px).
    expect(SECRET_STATE_TEXT.none).toEqual({ ja: '未発行', en: 'Not issued' });
    expect(SECRET_STATE_TEXT.active).toEqual({ ja: '発行済み', en: 'Issued' });
    expect(SECRET_STATE_TEXT.reissue_required).toEqual({ ja: '再発行が必要', en: 'Reissue required' });
    for (const text of Object.values(SECRET_STATE_TEXT)) expect(text.en.length).toBeLessThanOrEqual(16);
    expect(secretStateDetail({ state: 'none' }, date).ja).toBe('署名鍵が未発行のため、まだ送信していません。');
    expect(
      secretStateDetail({ state: 'active', issuedAt: '2026-10-30T01:00:00Z', issuedByName: 'Admin' }, date),
    ).toEqual({
      ja: '署名鍵を 2026-10-30 に Admin が発行しました。',
      en: 'Signing secret issued 2026-10-30 by Admin.',
    });
    expect(secretStateDetail({ state: 'active', issuedAt: '2026-10-30T01:00:00Z' }, date).en).toBe(
      'Signing secret issued 2026-10-30.',
    );
    expect(secretStateDetail({ state: 'reissue_required' }, date)).toEqual({
      ja: 'URL が変わったため、管理者が署名鍵を再発行するまで送信を止めています。',
      en: 'The URL changed, so sending is paused until an administrator reissues the signing secret.',
    });
  });

  it('AC-26 AC-27 inbox mail reasons and the company-admin navigation condition', () => {
    expect(notificationReason(undefined)).toBeNull();
    expect(notificationReason({ inboxEmail: false, available: true })).toBeNull();
    expect(notificationReason({ inboxEmail: false, available: false, reason: 'company_disabled' })?.ja).toBe(
      '会社でメール通知が有効になっていません',
    );
    expect(notificationReason({ inboxEmail: false, available: false, reason: 'mail_not_configured' })?.ja).toBe(
      'メール送信が設定されていません',
    );
    expect(isCompanyAdmin(['admin'])).toBe(true);
    expect(isCompanyAdmin(['settings'])).toBe(false);
    expect(isCompanyAdmin(undefined)).toBe(false);
  });
});
