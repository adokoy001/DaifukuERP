import { request as https } from 'node:https';
import { request as http } from 'node:http';
import { readFile } from 'node:fs/promises';
import { EdgeError } from './errors.ts';
export interface HttpOptions { caFile?: string; timeoutMs: number; limitBytes: number; signal?: AbortSignal }
export async function bytesRequest(url: URL, method: 'GET' | 'POST', headers: Record<string, string>, body: Buffer | undefined, options: HttpOptions): Promise<{ status: number; type: string; body: Buffer }> {
  const ca = options.caFile ? await readFile(options.caFile) : undefined;
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http)(url, { method, headers, rejectUnauthorized: true, ...(ca ? { ca } : {}), ...(options.signal ? { signal: options.signal } : {}), agent: false }, (response) => {
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (data: Buffer) => { size += data.length; if (size > options.limitBytes) { response.destroy(); request.destroy(); reject(new EdgeError('response_too_large')); } else chunks.push(data); });
      response.once('error', () => reject(new EdgeError('transport_failed')));
      response.once('end', () => resolve({ status: response.statusCode ?? 0, type: response.headers['content-type'] ?? '', body: Buffer.concat(chunks) }));
    });
    const timer = setTimeout(() => request.destroy(new EdgeError('request_timeout')), options.timeoutMs);
    request.once('close', () => clearTimeout(timer));
    request.once('error', () => reject(new EdgeError('transport_failed')));
    if (body) request.end(body); else request.end();
  });
}
