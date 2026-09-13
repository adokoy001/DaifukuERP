import { scryptSync } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { authenticate } from '../src/auth.ts';
import { users } from '../src/db/system-tables.ts';
import { newId } from '../src/ids.ts';
import * as hashing from '../src/password-hash.ts';
import { freshDb, type TestDb } from '../src/testing.ts';
import { withIdentityAttempt } from '../src/identity/rate-limit.ts';
import { passwordWorkUnavailable } from '../src/password-work-queue.ts';

const password = 'Synthetic-existing-account-あ';
const salt = '0123456789abcdef0123456789abcdef';
const legacy = `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
let db: TestDb;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function account(hash = legacy, tenantId?: string) {
  const id = newId(),
    email = `${id}@example.invalid`;
  await db.owner.drizzle.insert(users).values({
    id,
    tenantId: tenantId ?? db.tenantId,
    email,
    name: 'Existing employee',
    passwordHash: hash,
    version: 7,
    sessionVersion: 4,
  });
  return { id, email };
}
async function stored(id: string) {
  const [row] = await db.owner.drizzle.select().from(users).where(eq(users.id, id));
  if (!row) throw new Error('Missing synthetic test account');
  return row;
}
beforeAll(async () => {
  db = await freshDb();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await db?.close();
});

describe('password hash upgrade under real database concurrency', () => {
  it('preserves the identity, account version and sessions while upgrading a correct legacy password', async () => {
    const user = await account(),
      before = await stored(user.id);
    const principal = await authenticate(db.owner, user.email, password, db.tenantId);
    expect(principal).toMatchObject({ userId: user.id, tenantId: db.tenantId, sessionVersion: 4 });
    const after = await stored(user.id);
    expect(after.passwordHash).toMatch(/^scrypt\$v1\$/);
    expect({ ...after, passwordHash: before.passwordHash }).toEqual(before);
    expect(await hashing.verifyPassword(password, after.passwordHash)).toBe(true);
    expect(await authenticate(db.owner, user.email, password, db.tenantId)).toMatchObject({ userId: user.id });
    expect((await stored(user.id)).passwordHash).toBe(after.passwordHash);
  });
  it('does not write for wrong passwords, malformed hashes, inactive identities or wrong tenants', async () => {
    const user = await account(),
      before = await stored(user.id);
    expect(await authenticate(db.owner, user.email, 'wrong', db.tenantId)).toBeNull();
    expect(await authenticate(db.owner, user.email, password, newId())).toBeNull();
    expect(await stored(user.id)).toEqual(before);
    const malformed = await account(legacy + '$extra');
    expect(await authenticate(db.owner, malformed.email, password, db.tenantId)).toBeNull();
    expect((await stored(malformed.id)).passwordHash).toBe(legacy + '$extra');
    await db.owner.drizzle.update(users).set({ active: 0 }).where(eq(users.id, user.id));
    expect(await authenticate(db.owner, user.email, password, db.tenantId)).toBeNull();
    expect((await stored(user.id)).passwordHash).toBe(legacy);
  });
  it('allows two correct legacy logins to converge on one upgrade without revoking sessions', async () => {
    const user = await account();
    const results = await Promise.all([
      authenticate(db.owner, user.email, password),
      authenticate(db.owner, user.email, password),
    ]);
    for (const result of results) expect(result).toMatchObject({ userId: user.id, sessionVersion: 4 });
    expect((await stored(user.id)).sessionVersion).toBe(4);
    expect(await hashing.verifyPassword(password, (await stored(user.id)).passwordHash)).toBe(true);
  });
  for (const mutation of ['reset', 'deactivate', 'revoke'] as const) {
    it(`does not overwrite or issue old authority when ${mutation} commits during rehash`, async () => {
      const user = await account();
      const original = hashing.hashPassword;
      const started = deferred(),
        resume = deferred();
      vi.spyOn(hashing, 'hashPassword').mockImplementationOnce(async (input) => {
        started.resolve();
        await resume.promise;
        return original(input);
      });
      const login = authenticate(db.owner, user.email, password);
      await started.promise;
      try {
        const replacement = mutation === 'reset' ? await original('Synthetic-reset-replacement') : legacy;
        await db.owner.drizzle
          .update(users)
          .set({ passwordHash: replacement, active: mutation === 'deactivate' ? 0 : 1, version: 8, sessionVersion: 5 })
          .where(eq(users.id, user.id));
        const protectedRow = await stored(user.id);
        resume.resolve();
        expect(await login).toBeNull();
        expect(await stored(user.id)).toEqual(protectedRow);
      } finally {
        resume.resolve();
        await login;
      }
    });
  }
  it('rechecks a current-format account after asynchronous verification races with reset', async () => {
    const user = await account(await hashing.hashPassword(password));
    const original = hashing.verifyPassword;
    const started = deferred(),
      resume = deferred();
    vi.spyOn(hashing, 'verifyPassword').mockImplementationOnce(async (input, value) => {
      const result = await original(input, value);
      started.resolve();
      await resume.promise;
      return result;
    });
    const login = authenticate(db.owner, user.email, password);
    await started.promise;
    try {
      await db.owner.drizzle
        .update(users)
        .set({
          passwordHash: await hashing.hashPassword('Synthetic-new-current-password'),
          sessionVersion: 5,
          version: 8,
        })
        .where(eq(users.id, user.id));
      resume.resolve();
      expect(await login).toBeNull();
      expect((await stored(user.id)).sessionVersion).toBe(5);
    } finally {
      resume.resolve();
      await login;
    }
  });
  it('propagates unavailable crypto as a rejected login without upgrading the account', async () => {
    const user = await account(),
      before = await stored(user.id);
    vi.spyOn(hashing, 'verifyPassword').mockRejectedValueOnce(new Error('Synthetic unavailable crypto'));
    await expect(authenticate(db.owner, user.email, password)).rejects.toThrow('Synthetic unavailable crypto');
    expect(await stored(user.id)).toEqual(before);
  });
  it('refunds overload reservations without erasing real failed verification attempts', async () => {
    const limits = [{ key: `password-overload-${newId()}`, limit: 1 }];
    for (let index = 0; index < 3; index++) {
      await expect(
        withIdentityAttempt(db.owner, limits, async () => {
          throw passwordWorkUnavailable();
        }),
      ).rejects.toMatchObject({ httpStatus: 503 });
    }
    await expect(withIdentityAttempt(db.owner, limits, async () => true)).resolves.toBe(true);
    await expect(
      withIdentityAttempt(db.owner, limits, async () => {
        throw new Error('Synthetic wrong credential');
      }),
    ).rejects.toThrow('Synthetic wrong credential');
    await expect(withIdentityAttempt(db.owner, limits, async () => true)).rejects.toMatchObject({ httpStatus: 429 });
  });
});
