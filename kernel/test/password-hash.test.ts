import { scrypt, scryptSync } from 'node:crypto';
import type * as Crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DUMMY_PASSWORD_HASH, hashPassword, passwordNeedsRehash, verifyPassword } from '../src/password-hash.ts';
vi.mock('node:crypto', async (original) => ({
  ...(await original<typeof Crypto>()),
  scrypt: vi.fn((await original<typeof Crypto>()).scrypt),
}));
afterEach(() => vi.mocked(scrypt).mockClear());
const password = 'Synthetic-compatibility-あ-🔐';
const salt = '0123456789abcdef0123456789abcdef';
const legacy = `scrypt$${salt}$${scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex')}`;
describe('versioned asynchronous password hashing', () => {
  it('round trips Unicode without normalization, records the bounded profile, and uses unique salts', async () => {
    const a = await hashPassword(password);
    const b = await hashPassword(password);
    expect(a).toMatch(/^scrypt\$v1\$32768\$8\$3\$64\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword(password, a)).toBe(true);
    expect(await verifyPassword(password + 'wrong', a)).toBe(false);
    expect(passwordNeedsRehash(a)).toBe(false);
    expect(scrypt).toHaveBeenCalled();
  });
  it('reads the exact original UTF-8 hexadecimal-text salt rather than decoding its bytes', async () => {
    expect(await verifyPassword(password, legacy)).toBe(true);
    expect(await verifyPassword('wrong', legacy)).toBe(false);
    expect(passwordNeedsRehash(legacy)).toBe(true);
    const decodedSalt = `scrypt$${salt}$${scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex')}`;
    expect(await verifyPassword(password, decodedSalt)).toBe(false);
  });
  it('rejects malformed, unsupported and oversized records before allocating crypto work', async () => {
    vi.mocked(scrypt).mockClear();
    const invalid = [
      null,
      '',
      'other$hash',
      legacy + '$extra',
      legacy + '\n',
      legacy.toUpperCase(),
      legacy.slice(0, -2),
      DUMMY_PASSWORD_HASH.replace('$v1$', '$v2$'),
      DUMMY_PASSWORD_HASH.replace('$32768$', '$131072$'),
      DUMMY_PASSWORD_HASH.replace('$32768$', '$032768$'),
      DUMMY_PASSWORD_HASH.replace('$8$', '$80$'),
      DUMMY_PASSWORD_HASH.replace('$3$', '$300000$'),
      DUMMY_PASSWORD_HASH.replace('$64$', '$9999999$'),
      DUMMY_PASSWORD_HASH.replace('$32768$', '$NaN$'),
      'x'.repeat(10000),
    ];
    for (const stored of invalid) {
      expect(await verifyPassword(password, stored)).toBe(false);
      expect(passwordNeedsRehash(stored)).toBe(false);
    }
    expect(await verifyPassword('', DUMMY_PASSWORD_HASH)).toBe(false);
    expect(await verifyPassword('x'.repeat(201), DUMMY_PASSWORD_HASH)).toBe(false);
    expect(scrypt).not.toHaveBeenCalled();
    await expect(hashPassword('')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(hashPassword('x'.repeat(201))).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('has current-cost dummy verification without generating hashes at module import', async () => {
    expect(await verifyPassword('unknown-account-password', DUMMY_PASSWORD_HASH)).toBe(false);
    expect(passwordNeedsRehash(DUMMY_PASSWORD_HASH)).toBe(false);
  });
  it('turns native synchronous and callback errors into sanitized rejected promises and recovers capacity', async () => {
    vi.mocked(scrypt).mockImplementationOnce(() => {
      throw new Error('synthetic native details');
    });
    await expect(hashPassword(password)).rejects.toMatchObject({
      httpStatus: 503,
      message: 'Password verification is temporarily busy.',
    });
    vi.mocked(scrypt).mockImplementationOnce((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error, result: Buffer) => void;
      queueMicrotask(() => callback(new Error('synthetic callback details'), Buffer.alloc(0)));
    });
    await expect(verifyPassword(password, legacy)).rejects.toMatchObject({
      httpStatus: 503,
      message: 'Password verification is temporarily busy.',
    });
    expect(await verifyPassword(password, legacy)).toBe(true);
  });
});
