// Storage port (ADR-0013): binary evidence files (証憑). Content-addressed keys; no delete API by design
// (電帳法: stored evidence is never removed, only superseded — the attachments module records that).
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { newId } from './ids.ts';

export interface StoredObject {
  key: string;
  size: number;
  sha256: string;
  contentType: string;
  filename: string;
}

export interface StoragePort {
  put(tenantId: string, data: Uint8Array, meta: { filename: string; contentType: string }): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
}

const SAFE_KEY = /^[a-z0-9-]+\/[a-z0-9-]+$/;

/** Files under `${root}/<tenantId>/<id>` plus a `.meta.json` sidecar. Good enough for dev and small deployments. */
export class LocalStorage implements StoragePort {
  constructor(private readonly root: string) {}

  async put(tenantId: string, data: Uint8Array, meta: { filename: string; contentType: string }): Promise<StoredObject> {
    const key = `${tenantId}/${newId()}`;
    const path = join(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { flag: 'wx' });
    const sha256 = createHash('sha256').update(data).digest('hex');
    const obj: StoredObject = { key, size: data.byteLength, sha256, contentType: meta.contentType, filename: meta.filename };
    await writeFile(`${path}.meta.json`, JSON.stringify(obj), { flag: 'wx' });
    return obj;
  }

  async get(key: string): Promise<Uint8Array> {
    if (!SAFE_KEY.test(key)) throw new Error(`storage: invalid key ${key}`);
    return new Uint8Array(await readFile(join(this.root, key)));
  }

  async exists(key: string): Promise<boolean> {
    if (!SAFE_KEY.test(key)) return false;
    try {
      await access(join(this.root, key));
      return true;
    } catch {
      return false;
    }
  }
}

let configured: StoragePort | null = null;

/** Apps call this once at startup (tests: a temp dir). */
export function configureStorage(port: StoragePort): void {
  configured = port;
}

export function storage(): StoragePort {
  if (!configured) throw new Error('storage is not configured. Call configureStorage(new LocalStorage(dir)) at app startup (DAIFUKU_STORAGE_DIR).');
  return configured;
}
