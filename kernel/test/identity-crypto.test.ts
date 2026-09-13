import { describe, expect, it } from 'vitest';
import { base32, matchingTotpStep, seal, tokenHash, totp, unseal } from '../src/identity/crypto.ts';
const key = Buffer.alloc(32, 7).toString('base64');
describe('identity cryptographic boundaries', () => {
  it('matches the published RFC 6238 SHA1 vectors', () => {
    const secret = base32(Buffer.from('12345678901234567890'));
    for (const [seconds, code] of [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ] as const)
      expect(totp(secret, Math.floor(seconds / 30), 8)).toBe(code);
  });
  it('accepts only the bounded unused TOTP window', () => {
    const secret = base32(Buffer.alloc(20, 1)),
      now = new Date(3000000),
      step = 100;
    expect(matchingTotpStep(secret, totp(secret, step), now)).toBe(step);
    expect(matchingTotpStep(secret, totp(secret, step), now, step)).toBeNull();
    expect(matchingTotpStep(secret, totp(secret, step - 2), now)).toBeNull();
    expect(matchingTotpStep(secret, 'bad', now)).toBeNull();
  });
  it('authenticates ciphertext against tenant/user/purpose and rejects tampering', () => {
    const first = seal('private', key, 'tenant:user:mfa'),
      second = seal('private', key, 'tenant:user:mfa');
    expect(first).not.toBe(second);
    expect(unseal(first, key, 'tenant:user:mfa')).toBe('private');
    expect(() => unseal(first, key, 'other:user:mfa')).toThrow();
    expect(() => unseal(first, Buffer.alloc(32, 8).toString('base64'), 'tenant:user:mfa')).toThrow();
    expect(() => unseal(first + 'x', key, 'tenant:user:mfa')).toThrow();
    expect(tokenHash('token')).not.toContain('token');
  });
});
