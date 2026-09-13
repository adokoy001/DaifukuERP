import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { edgeNotification, edgeRoutes } from '@daifuku/mod-edge-integration/contract';
import type { EdgeConfig } from './config.ts';
export async function notifications(
  config: EdgeConfig,
  credential: () => string,
  wake: () => void,
  signal: AbortSignal,
): Promise<void> {
  const ca = config.caFile ? await readFile(config.caFile) : undefined;
  let backoff = 1000;
  while (!signal.aborted) {
    await new Promise<void>((resolve) => {
      const url = new URL(config.apiBaseUrl.replace(/\/$/, '') + edgeRoutes.notifications);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(url, {
        headers: { authorization: 'Bearer ' + credential() },
        rejectUnauthorized: true,
        ...(ca ? { ca } : {}),
        perMessageDeflate: false,
        maxPayload: 4096,
        handshakeTimeout: config.requestTimeoutMs,
        followRedirects: false,
      });
      let pongAt = Date.now();
      const stop = () => socket.terminate();
      signal.addEventListener('abort', stop, { once: true });
      const heartbeat = setInterval(() => {
        if (Date.now() - pongAt > 60000) socket.terminate();
        else if (socket.readyState === WebSocket.OPEN) socket.ping();
      }, 20000);
      socket.on('open', () => {
        backoff = 1000;
        wake();
      });
      socket.on('pong', () => {
        pongAt = Date.now();
      });
      socket.on('message', (data, binary) => {
        try {
          if (binary || !edgeNotification.safeParse(JSON.parse(data.toString())).success)
            socket.close(1008, 'invalid_notification');
          else wake();
        } catch {
          socket.close(1008, 'invalid_notification');
        }
      });
      socket.on('error', () => socket.terminate());
      socket.once('close', () => {
        clearInterval(heartbeat);
        signal.removeEventListener('abort', stop);
        resolve();
      });
      if (signal.aborted) stop();
    });
    if (!signal.aborted)
      await delay(Math.round(backoff * (0.8 + Math.random() * 0.4)), undefined, { signal }).catch(() => undefined);
    backoff = Math.min(60000, backoff * 2);
  }
}
export class Wakeup {
  private resolve: (() => void) | undefined;
  private pending = false;
  wake(): void {
    this.pending = true;
    this.resolve?.();
  }
  async wait(ms: number, signal: AbortSignal): Promise<void> {
    if (this.pending || signal.aborted) {
      this.pending = false;
      return;
    }
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        this.resolve = undefined;
        this.pending = false;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.resolve = done;
      signal.addEventListener('abort', done, { once: true });
    });
  }
}
