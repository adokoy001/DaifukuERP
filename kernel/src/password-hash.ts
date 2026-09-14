import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { ValidationError } from './errors.ts';
import { PasswordWorkQueue, passwordWorkUnavailable } from './password-work-queue.ts';

// OWASP scrypt alternative: 32 MiB, r=8, p=3. Two active jobs and eight waiting per process.
// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html (2026-09-14)
const CURRENT = { N: 32768, r: 8, p: 3, keylen: 64 } as const;
const LEGACY = { N: 16384, r: 8, p: 1, keylen: 64 } as const;
const MAX_MEMORY = 48 * 1024 * 1024;
const work = new PasswordWorkQueue(2, 8, 5000);
const PREFIX = `scrypt$v1$${CURRENT.N}$${CURRENT.r}$${CURRENT.p}$${CURRENT.keylen}$`;
interface StoredPassword {
  parameters: typeof CURRENT | typeof LEGACY;
  salt: string;
  hash: string;
  legacy: boolean;
}
function validPassword(password: string): boolean {
  return typeof password === 'string' && password.length > 0 && password.length <= 200;
}
function decode(stored: string | null): StoredPassword | null {
  if (typeof stored !== 'string' || stored.length > 256) return null;
  const old = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(stored);
  if (old?.[0] === stored && old[1] && old[2]) return { parameters: LEGACY, salt: old[1], hash: old[2], legacy: true };
  // A profile allowlist bounds both CPU and memory, even for a corrupted database value.
  const current = /^scrypt\$v1\$32768\$8\$3\$64\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(stored);
  return current?.[0] === stored && current[1] && current[2]
    ? { parameters: CURRENT, salt: current[1], hash: current[2], legacy: false }
    : null;
}
function derive(password: string, salt: string, parameters: StoredPassword['parameters']): Promise<Buffer> {
  return work.run(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        const { keylen, ...cost } = parameters;
        // Legacy salt is the hexadecimal text as UTF-8, not Buffer.from(salt, 'hex'). Keep that interpretation.
        try {
          scrypt(password, salt, keylen, { ...cost, maxmem: MAX_MEMORY }, (error, result) => {
            if (error) reject(passwordWorkUnavailable());
            else resolve(result);
          });
        } catch {
          reject(passwordWorkUnavailable());
        }
      }),
  );
}
export async function hashPassword(password: string): Promise<string> {
  if (!validPassword(password))
    throw new ValidationError('Invalid password length.', [{ path: 'password', message: 'Use 1 to 200 characters.' }]);
  const salt = randomBytes(16).toString('hex');
  const result = await derive(password, salt, CURRENT);
  return `${PREFIX}${salt}$${result.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const decoded = decode(stored);
  if (!validPassword(password) || !decoded) return false;
  const candidate = await derive(password, decoded.salt, decoded.parameters);
  return timingSafeEqual(candidate, Buffer.from(decoded.hash, 'hex'));
}
export function passwordNeedsRehash(stored: string | null): boolean {
  return decode(stored)?.legacy === true;
}
// A well-formed, non-account comparison value gives unknown users current-cost verification without startup crypto.
export const DUMMY_PASSWORD_HASH = `${PREFIX}${'0'.repeat(32)}$${'0'.repeat(128)}`;
