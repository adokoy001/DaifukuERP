import { createHash } from 'node:crypto';

/** SHA-256 content identity only. A digest is not a signature or proof of who supplied the source. */
export function contentHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
export function contentHashBytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
