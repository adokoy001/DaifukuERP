// docs/specs/machine-credentials.md: pure parts of the machine credential kernel (format, schema, status, context).
import { describe, expect, it } from 'vitest';
import {
  isMachineTokenFormat,
  issueMachineCredentialSchema,
  machineContextParams,
  machineCredentialStatus,
  machineDenialReason,
  newMachineToken,
  revokeMachineCredentialSchema,
} from '../src/machine-credentials.ts';
import { requireHumanUserId } from '../src/access-admin-common.ts';
import type { Context } from '../src/context.ts';

const now = new Date('2026-10-30T00:00:00Z');
const later = new Date('2026-11-30T00:00:00Z');
const valid = {
  name: 'EC 連携',
  purpose: 'integration',
  companyId: '018f0000-0000-7000-8000-000000000001',
  roles: ['sales'],
  expiresInDays: 90,
  stepUpToken: 'a'.repeat(43),
};

describe('machine token format (AC-1)', () => {
  it('AC-1 issues dfk_ plus 43 base64url characters and recognizes only that shape', () => {
    const token = newMachineToken();
    expect(token).toMatch(/^dfk_[A-Za-z0-9_-]{43}$/);
    expect(isMachineTokenFormat(token)).toBe(true);
    expect(newMachineToken()).not.toBe(token);
    for (const bad of [
      'dfk_',
      `dfk_${'a'.repeat(42)}`,
      `dfk_${'a'.repeat(44)}`,
      `dfk_${'a'.repeat(42)}=`,
      'a'.repeat(47),
    ])
      expect(isMachineTokenFormat(bad)).toBe(false);
  });
});

describe('issue and revoke input (AC-3, AC-17)', () => {
  it('AC-3 accepts the documented body', () => {
    expect(issueMachineCredentialSchema.safeParse(valid).success).toBe(true);
  });
  it.each([
    ['empty name', { name: '   ' }],
    ['name over 100', { name: 'x'.repeat(101) }],
    ['unknown purpose', { purpose: 'browser' }],
    ['no roles', { roles: [] }],
    ['51 roles', { roles: Array.from({ length: 51 }, (_, i) => `r${i}`) }],
    ['malformed role', { roles: ['Sales!'] }],
    ['zero days', { expiresInDays: 0 }],
    ['366 days', { expiresInDays: 366 }],
    ['fractional days', { expiresInDays: 1.5 }],
    ['short step-up token', { stepUpToken: 'abc' }],
    ['accessScope', { accessScope: 'stores' }],
    ['storeIds', { storeIds: [] }],
    ['siteIds', { siteIds: [] }],
    ['tenantAdmin', { tenantAdmin: true }],
  ])('AC-3 rejects %s', (_label, patch) => {
    expect(issueMachineCredentialSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
  it('AC-17 revoke accepts an optional reason of at most 200 characters and nothing else', () => {
    expect(revokeMachineCredentialSchema.safeParse({}).success).toBe(true);
    expect(revokeMachineCredentialSchema.safeParse({ reason: 'x'.repeat(200) }).success).toBe(true);
    expect(revokeMachineCredentialSchema.safeParse({ reason: 'x'.repeat(201) }).success).toBe(false);
    expect(revokeMachineCredentialSchema.safeParse({ reason: 'ok', force: true }).success).toBe(false);
  });
});

describe('status and refusal reasons (AC-8, AC-10, AC-20)', () => {
  const admin = { active: true, tenantAdmin: true };
  const row = { revokedAt: null, expiresAt: later, purpose: 'integration', companyId: 'c1' };
  it('AC-20 orders the status revoked, expired, suspended, active', () => {
    expect(machineCredentialStatus({ revokedAt: now, expiresAt: now }, null, later)).toBe('revoked');
    expect(machineCredentialStatus({ revokedAt: null, expiresAt: now }, null, later)).toBe('expired');
    expect(
      machineCredentialStatus({ revokedAt: null, expiresAt: later }, { active: false, tenantAdmin: true }, now),
    ).toBe('suspended');
    expect(
      machineCredentialStatus({ revokedAt: null, expiresAt: later }, { active: true, tenantAdmin: false }, now),
    ).toBe('suspended');
    expect(machineCredentialStatus({ revokedAt: null, expiresAt: later }, admin, now)).toBe('active');
    // the expiry instant itself is already expired
    expect(machineCredentialStatus({ revokedAt: null, expiresAt: now }, admin, now)).toBe('expired');
  });
  it('AC-8 AC-10 reports the first refusal reason in a fixed order', () => {
    expect(machineDenialReason({ ...row, revokedAt: now, expiresAt: now }, null, 'mcp', 'x', later)).toBe('revoked');
    expect(machineDenialReason({ ...row, expiresAt: now }, null, 'mcp', 'x', later)).toBe('expired');
    expect(machineDenialReason(row, null, 'mcp', 'x', now)).toBe('purpose_mismatch');
    expect(machineDenialReason(row, { active: false, tenantAdmin: true }, 'integration', 'x', now)).toBe(
      'issuer_inactive',
    );
    expect(machineDenialReason(row, admin, 'integration', 'other', now)).toBe('company_mismatch');
    expect(machineDenialReason(row, admin, 'integration', 'c1', now)).toBeNull();
    expect(machineDenialReason(row, admin, 'integration', undefined, now)).toBeNull();
  });
});

describe('machine context (AC-7) and human-only ids (AC-22)', () => {
  it('AC-7 builds a company-wide, non-admin context whose actor is the credential', () => {
    expect(
      machineContextParams({
        credentialId: 'k1',
        tenantId: 't1',
        companyId: 'c1',
        name: 'n',
        purpose: 'integration',
        roles: ['sales', 'viewer'],
        expiresAt: later,
      }),
    ).toEqual({
      tenantId: 't1',
      companyId: 'c1',
      actor: { type: 'machine', id: 'k1' },
      roles: ['sales', 'viewer'],
      tenantAdmin: false,
      accessScope: 'all',
      storeIds: [],
      siteIds: [],
      mfaVerified: false,
    });
  });
  it('AC-22 requireHumanUserId returns the person and refuses a machine credential with 403', () => {
    const ctx = (actor: Context['actor']) => ({ actor, roles: ['admin'] }) as unknown as Context;
    expect(requireHumanUserId(ctx({ type: 'user', id: 'u1' }))).toBe('u1');
    expect(requireHumanUserId(ctx({ type: 'agent', id: 'a1', onBehalfOf: 'u2' }))).toBe('u2');
    expect(requireHumanUserId(ctx({ type: 'system', id: 'system' }))).toBe('system');
    expect(requireHumanUserId(ctx({ type: 'relay', id: 'g1' }))).toBe('g1');
    expect(() => requireHumanUserId(ctx({ type: 'machine', id: 'k1' }))).toThrow(
      expect.objectContaining({ httpStatus: 403, details: expect.objectContaining({ op: 'human-actor-required' }) }),
    );
  });
});
