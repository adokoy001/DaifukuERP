// Content hash for duplicate detection (docs/specs/attachments.md AC-7). Uses the Web Crypto global so the module
// stays free of node:* imports (ADR-0013); the storage port computes the same digest and the two are cross-checked.
export async function sha256Hex(data: Uint8Array): Promise<string> {
  // BufferSource (lib.dom) wants a view over a plain ArrayBuffer; a view over a SharedArrayBuffer is copied first.
  const bytes: Uint8Array<ArrayBuffer> = data.buffer instanceof ArrayBuffer ? (data as Uint8Array<ArrayBuffer>) : data.slice();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
