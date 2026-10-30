// docs/specs/machine-credentials.md AC-27, AC-28, AC-33: pure rules of the /admin/tokens screen.
import { describe, expect, it } from 'vitest';
import {
  auditOpLabel,
  daysLeft,
  deactivationWarning,
  draftErrors,
  emptyDraft,
  expiryNote,
  firstErrorField,
  issueField,
  outcomeUnknown,
  reasonText,
  STATUS_LABEL,
  usageText,
} from './machine-credentials.ts';

const now = new Date('2026-10-30T00:00:00Z');
const at = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();

describe('issue draft (AC-28)', () => {
  it('AC-28 defaults to an integration key in the given company for 90 days', () => {
    expect(emptyDraft('c1')).toMatchObject({ purpose: 'integration', companyId: 'c1', expiresInDays: 90, roles: [] });
  });
  it('AC-28 requires a name, a role and the current password (and a code with MFA) before sending', () => {
    const errors = draftErrors({ ...emptyDraft('c1'), name: '  ' }, true);
    expect(Object.keys(errors).sort()).toEqual(['code', 'name', 'password', 'roles']);
    expect(errors.name).toEqual({ ja: '名前を入力してください。', en: 'Enter a name.' });
    expect(firstErrorField(errors)).toBe('name');
    expect(draftErrors({ ...emptyDraft('c1'), name: 'x', roles: ['sales'], password: 'p' }, false)).toEqual({});
    expect(
      draftErrors({ ...emptyDraft('c1'), name: 'x'.repeat(101), roles: ['sales'], password: 'p' }, false).name?.en,
    ).toBe('Use at most 100 characters.');
  });
  it('AC-28 maps server issue paths onto the dialog fields', () => {
    expect(issueField('name')).toBe('name');
    expect(issueField('roles.1')).toBe('roles');
    expect(issueField('body.expiresInDays')).toBe('expiresInDays');
    expect(issueField('stepUpToken')).toBeUndefined();
  });
  it('AC-28 treats a lost response or a server error as an unknown outcome', () => {
    expect(outcomeUnknown(undefined)).toBe(true);
    expect(outcomeUnknown(0)).toBe(true);
    expect(outcomeUnknown(502)).toBe(true);
    expect(outcomeUnknown(409)).toBe(false);
  });
});

describe('list text (AC-27)', () => {
  it('AC-27 labels every status in both languages', () => {
    expect(STATUS_LABEL).toEqual({
      active: { ja: '有効', en: 'Active' },
      expired: { ja: '期限切れ', en: 'Expired' },
      revoked: { ja: '失効', en: 'Revoked' },
      suspended: { ja: '停止中', en: 'Suspended' },
    });
  });
  it('AC-27 shows "N days left" for active keys expiring within 30 days', () => {
    expect(daysLeft(at(0.1), now)).toBe(1);
    expect(expiryNote({ status: 'active', expiresAt: at(12) }, now)).toEqual({
      ja: '期限まで 12 日',
      en: '12 days left',
    });
    expect(expiryNote({ status: 'active', expiresAt: at(1) }, now)?.en).toBe('1 day left');
    expect(expiryNote({ status: 'active', expiresAt: at(31) }, now)).toBeNull();
    expect(expiryNote({ status: 'revoked', expiresAt: at(3) }, now)).toBeNull();
  });
  it('AC-28 explains how to use the key for its purpose', () => {
    expect(usageText('integration').snippet).toBe('Authorization: Bearer <API key>');
    expect(usageText('mcp').snippet).toBe('DAIFUKU_API_KEY=<API key>');
    expect(usageText('mcp').label.ja).toContain('MCP');
  });
  it('AC-30 translates history events and system reasons and keeps typed reasons as written', () => {
    expect(auditOpLabel('use_denied')).toEqual({ ja: '拒否', en: 'Refused' });
    expect(reasonText('issuer_deactivated')).toEqual({ ja: '発行者の無効化', en: 'Issuer deactivated' });
    expect(reasonText('連携の終了')).toEqual({ ja: '連携の終了', en: '連携の終了' });
    expect(reasonText(null)).toBeNull();
  });
});

describe('deactivation warning (AC-33)', () => {
  it('AC-33 names the number of live keys that will be revoked, and nothing when there are none', () => {
    expect(deactivationWarning(0)).toBeNull();
    expect(deactivationWarning(1)).toEqual({
      ja: 'この利用者が発行した有効な API キー 1 件も失効します。',
      en: '1 active API key issued by this user will be revoked.',
    });
    expect(deactivationWarning(3)?.en).toBe('3 active API keys issued by this user will be revoked.');
  });
});
