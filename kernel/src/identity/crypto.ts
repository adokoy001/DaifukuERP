import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { StateError } from '../errors.ts';
export const opaqueToken = (): string => randomBytes(32).toString('base64url');
export const tokenHash = (value: string): string => createHash('sha256').update(value).digest('hex');
export function encryptionKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) throw new StateError('Identity encryption key is invalid.', 'Configure a base64 encoded 32-byte key.');
  return key;
}
export function seal(value: string, key: string, purpose: string): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(key), iv);
  cipher.setAAD(Buffer.from(purpose));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
}
export function unseal(value: string, key: string, purpose: string): string {
  const [iv, tag, data] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || iv.length !== 12 || !tag || tag.length !== 16 || !data) throw new Error('Invalid encrypted identity payload');
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey(key), iv); cipher.setAAD(Buffer.from(purpose)); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes: Uint8Array): string {
  let bits = 0, value = 0, result = '';
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { result += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) result += ALPHABET[(value << (5 - bits)) & 31]; return result;
}
function decode32(secret: string): Buffer {
  let bits = 0, value = 0; const bytes: number[] = [];
  for (const character of secret) { const digit = ALPHABET.indexOf(character); if (digit < 0) throw new Error('Invalid TOTP secret'); value = (value << 5) | digit; bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(bytes);
}
export const totpSecret = (): string => base32(randomBytes(20));
export function totp(secret: string, step: number, digits = 6): string {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', decode32(secret)).update(counter).digest(), offset = (digest[digest.length - 1] ?? 0) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}
export function matchingTotpStep(secret: string, code: string, now: Date, lastStep = -1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now.getTime() / 30000);
  for (const step of [current, current - 1, current + 1]) if (step >= 0 && step > lastStep && timingSafeEqual(Buffer.from(totp(secret, step)), Buffer.from(code))) return step;
  return null;
}
export function recoveryCodes(): string[] { return Array.from({ length: 10 }, () => randomBytes(16).toString('hex')); }
