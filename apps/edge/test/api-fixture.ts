// Starts the API's synthetic fixture as a separate process; no app-internal imports.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import type { Duplex } from 'node:stream';
import { z } from 'zod';
import { tlsFixture, listen } from './fixtures.ts';
const readySchema = z.object({
  type: z.literal('ready'),
  address: z.url(),
  pairingToken: z.string(),
  deviceId: z.uuid(),
  gatewayId: z.uuid(),
  jobId: z.uuid(),
  localDeviceId: z.string(),
});
export async function actualApiFixture() {
  const cwd = fileURLToPath(new URL('../../api/', import.meta.url));
  const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'test/edge-agent-fixture.ts'], {
    cwd,
    env: { ...process.env, DAIFUKU_EDGE_TEST_FIXTURE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout }),
    pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let readyResolve: (value: z.infer<typeof readySchema>) => void, readyReject: (error: Error) => void;
  const ready = new Promise<z.infer<typeof readySchema>>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const fail = (diagnostic = 'failed') => {
    const error = new Error('Synthetic API fixture ' + diagnostic);
    readyReject(error);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  child.on('error', () => fail());
  child.on('exit', () => {
    if (child.exitCode !== 0) fail();
  });
  child.stderr.on('data', () => undefined);
  lines.on('line', (line) => {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      if (value['type'] === 'ready') readyResolve(readySchema.parse(value));
      else if (value['type'] === 'result' && typeof value['id'] === 'string') {
        pending.get(value['id'])?.resolve(value['result']);
        pending.delete(value['id']);
      } else if (value['type'] === 'error') {
        const safe = z
          .object({
            operation: z.string().regex(/^[a-z_]+$/),
            status: z.number().nullable(),
            code: z.string().regex(/^[A-Z_]+$/),
          })
          .safeParse(value);
        fail(safe.success ? JSON.stringify(safe.data) : 'failed');
      } else fail();
    } catch {
      fail();
    }
  });
  const request = <T>(operation: string, extra: Record<string, unknown> = {}) =>
    new Promise<T>((resolve, reject) => {
      const id = randomUUID(),
        timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Synthetic API command timeout'));
        }, 15000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(JSON.stringify({ ...extra, id, operation }) + '\n');
    });
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    fail();
  }, 30000);
  try {
    const details = await ready;
    return {
      ...details,
      request,
      close: async () => {
        if (child.exitCode === null) await request('stop').catch(() => undefined);
        child.stdin.end();
        lines.close();
        if (child.exitCode === null) await new Promise<void>((resolve) => child.once('exit', () => resolve()));
      },
    };
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
/** HTTPS + raw WSS Upgrade reverse proxy, matching the deployed /api strip-prefix boundary. */
export async function apiTlsProxy(address: string) {
  const tls = await tlsFixture(),
    upstream = new URL(address),
    sockets = new Set<Duplex>();
  const state = { dropNext: '', calls: new Map<string, number>(), upgrades: 0, closedUpgrades: 0 };
  const server = createServer(tls.tls, (incoming, outgoing) => {
    const path = (incoming.url ?? '').replace(/^\/api(?=\/)/, '');
    state.calls.set(path, (state.calls.get(path) ?? 0) + 1);
    const request = httpRequest(
      new URL(path, upstream),
      { method: incoming.method, headers: incoming.headers },
      (response) => {
        if (state.dropNext === path) {
          state.dropNext = '';
          response.resume();
          response.on('end', () => outgoing.destroy());
          return;
        }
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    request.on('error', () => outgoing.destroy());
    incoming.pipe(request);
  });
  server.on('upgrade', (incoming, socket, head) => {
    sockets.add(socket);
    socket.once('close', () => {
      sockets.delete(socket);
      state.closedUpgrades++;
    });
    const path = (incoming.url ?? '').replace(/^\/api(?=\/)/, '');
    const request = httpRequest(new URL(path, upstream), { headers: incoming.headers });
    request.on('upgrade', (response, target, initial) => {
      state.upgrades++;
      sockets.add(target);
      target.once('close', () => sockets.delete(target));
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          Object.entries(response.headers)
            .map(([name, value]) => name + ': ' + String(value))
            .join('\r\n') +
          '\r\n\r\n',
      );
      if (initial.length) socket.write(initial);
      if (head.length) target.write(head);
      socket.pipe(target).pipe(socket);
      target.on('error', () => socket.destroy());
      socket.on('error', () => target.destroy());
    });
    request.on('response', () => socket.destroy());
    request.on('error', () => socket.destroy());
    request.end();
  });
  const port = await listen(server);
  return {
    ...tls,
    state,
    baseUrl: 'https://127.0.0.1:' + port + '/api',
    close: async () => {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await tls.close();
    },
  };
}
