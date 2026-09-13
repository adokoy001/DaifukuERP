import { createServer, type Server } from 'node:https';
import {
  createServer as httpServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { mkdtemp, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { WebSocketServer } from 'ws';
import {
  edgePayloadText,
  edgeRoutes,
  type EdgeClaimedJob,
  type EdgeJobRequest,
} from '@daifuku/mod-edge-integration/contract';
import { parseConfig, type EdgeConfig } from '../src/config.ts';
import { ippRequest, parseIpp, type IppAttribute } from '../src/drivers/ipp-codec.ts';
export const secret = () => randomBytes(32).toString('base64url');
export async function listen(server: Server | HttpServer): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  return address.port;
}
export const json = (response: ServerResponse, value: unknown, status = 200) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
};
export async function requestJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = [];
  for await (const part of request) parts.push(Buffer.from(part as Buffer));
  return parts.length ? (JSON.parse(Buffer.concat(parts).toString()) as Record<string, unknown>) : {};
}
export function job(
  request: EdgeJobRequest = { kind: 'cash.dispense', payload: { amount: '100', currency: 'JPY' } },
): EdgeClaimedJob {
  return {
    id: randomUUID(),
    deviceId: randomUUID(),
    localDeviceId: 'test1',
    driver: 'simulator',
    request,
    payloadHash: createHash('sha256').update(edgePayloadText(request)).digest('hex'),
    leaseToken: secret(),
    attempt: 1,
    leaseUntil: new Date(Date.now() + 90000).toISOString(),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
  };
}
export async function tlsFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'daifuku-edge-test-'));
  await chmod(directory, 0o700);
  const key = join(directory, 'key.pem'),
    cert = join(directory, 'cert.pem');
  await promisify(execFile)('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    key,
    '-out',
    cert,
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ]);
  await chmod(key, 0o600);
  await chmod(cert, 0o600);
  return {
    directory,
    cert,
    tls: { key: await readFile(key), cert: await readFile(cert) },
    close: () => rm(directory, { recursive: true, force: true }),
  };
}
export async function relayFixture() {
  const tls = await tlsFixture(),
    gatewayId = randomUUID(),
    companyId = randomUUID(),
    siteId = randomUUID();
  const state = {
    credential: '',
    version: 1,
    pairing: secret(),
    pairLost: false,
    rotateLost: false,
    startLost: false,
    completeLost: false,
    completeAccepted: true,
    completeIgnored: undefined as 'obsolete_attempt' | 'manually_resolved' | undefined,
    eventIgnored: undefined as 'expired' | undefined,
    startGranted: true,
    queued: null as EdgeClaimedJob | null,
    startCalls: 0,
    completeCalls: [] as Record<string, unknown>[],
    eventCalls: [] as Record<string, unknown>[],
    claims: 0,
    notifications: 0,
  };
  const session = () => ({
    gatewayId,
    companyId,
    siteId,
    credentialVersion: state.version,
    credentialExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    serverTime: new Date().toISOString(),
    protocolVersion: 1,
    pollAfterMs: 15000,
    heartbeatAfterMs: 20000,
  });
  const server = createServer(tls.tls, (request, response) => {
    void (async () => {
      const body = await requestJson(request),
        path = request.url,
        auth = request.headers.authorization;
      if (path === edgeRoutes.pair) {
        if (body['pairingToken'] !== state.pairing) return json(response, {}, 403);
        state.pairing = '';
        state.credential = String(body['credentialSecret']);
        if (state.pairLost) return request.socket.destroy();
        return json(response, session());
      }
      if (auth !== 'Bearer ' + state.credential || !state.credential) return json(response, {}, 401);
      if (path === edgeRoutes.session) return json(response, session());
      if (path === edgeRoutes.rotate) {
        state.credential = String(body['newCredentialSecret']);
        state.version++;
        if (state.rotateLost) return request.socket.destroy();
        return json(response, session());
      }
      if (path === edgeRoutes.claim) {
        state.claims++;
        const value = state.queued;
        state.queued = null;
        return json(response, { job: value, serverTime: new Date().toISOString(), pollAfterMs: 15000 });
      }
      if (path === edgeRoutes.start) {
        state.startCalls++;
        if (state.startLost) return request.socket.destroy();
        return json(response, {
          startGranted: state.startGranted,
          state: 'executing',
          leaseUntil: new Date(Date.now() + 90000).toISOString(),
          serverTime: new Date().toISOString(),
        });
      }
      if (path === edgeRoutes.heartbeat)
        return json(response, {
          accepted: true,
          state: 'executing',
          leaseUntil: new Date(Date.now() + 90000).toISOString(),
          serverTime: new Date().toISOString(),
        });
      if (path === edgeRoutes.complete) {
        state.completeCalls.push(body);
        if (state.completeLost) return request.socket.destroy();
        return json(response, {
          accepted: state.completeAccepted,
          state:
            state.completeIgnored === 'obsolete_attempt'
              ? 'claimed'
              : (body['result'] as Record<string, unknown>)['state'],
          version: 2,
          ...(state.completeIgnored ? { ignored: state.completeIgnored } : {}),
        });
      }
      if (path === edgeRoutes.event) {
        state.eventCalls.push(body);
        return json(response, {
          ok: true,
          duplicate: state.eventCalls.filter((row) => row['eventId'] === body['eventId']).length > 1,
          ...(state.eventIgnored ? { ignored: state.eventIgnored } : {}),
        });
      }
      json(response, {}, 404);
    })().catch(() => json(response, {}, 500));
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== edgeRoutes.notifications || request.headers.authorization !== 'Bearer ' + state.credential)
      return socket.destroy();
    state.notifications++;
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
      ws.send(JSON.stringify({ type: 'jobs_available', protocolVersion: 1 }));
    });
  });
  const port = await listen(server),
    config = (): EdgeConfig =>
      parseConfig({
        apiBaseUrl: `https://127.0.0.1:${port}`,
        caFile: tls.cert,
        requestTimeoutMs: 1000,
        printWaitMs: 2500,
        devices: [],
      });
  return {
    ...tls,
    state,
    server,
    wss,
    config,
    session,
    close: async () => {
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await tls.close();
    },
  };
}
export async function printerFixture(onPrint?: (count: number) => Promise<void>) {
  const state = {
    printCalls: 0,
    queryCalls: 0,
    lost: false,
    asciiOnly: false,
    reason: 'job-completed-successfully',
    jobStates: [9],
    jobId: 41,
    document: '',
  };
  const server = httpServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Buffer));
      const bytes = Buffer.concat(chunks),
        decoded = parseIpp(bytes),
        operation = decoded.code;
      let attributes: IppAttribute[];
      if (operation === 0x000b)
        attributes = [
          {
            name: 'document-format-supported',
            tag: 0x49,
            values: state.asciiOnly ? ['text/plain'] : ['text/plain', 'text/plain; charset=utf-8'],
          },
          { name: 'copies-supported', tag: 0x33, values: [[1, 5]] },
          { name: 'printer-is-accepting-jobs', tag: 0x22, values: [true] },
          { name: 'printer-state', tag: 0x23, values: [3] },
        ];
      else if (operation === 0x0002) {
        state.printCalls++;
        await onPrint?.(state.printCalls);
        if (state.lost) return request.socket.destroy();
        attributes = [
          { name: 'job-id', tag: 0x21, values: [state.jobId] },
          { name: 'job-state', tag: 0x23, values: [3] },
        ];
      } else {
        state.queryCalls++;
        attributes = [
          { name: 'job-id', tag: 0x21, values: [state.jobId] },
          {
            name: 'job-state',
            tag: 0x23,
            values: [state.jobStates[Math.min(state.queryCalls - 1, state.jobStates.length - 1)] ?? 9],
          },
          { name: 'job-state-reasons', tag: 0x44, values: [state.reason] },
        ];
      }
      const reply = ippRequest(0, 'ipp://fixture/printer', attributes).body;
      reply.writeInt32BE(decoded.requestId, 4);
      response.writeHead(200, { 'content-type': 'application/ipp' });
      response.end(reply);
    })().catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  const port = await listen(server);
  return {
    state,
    uri: `ipp://127.0.0.1:${port}/printer`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
export async function until(check: () => boolean, timeout = 3000): Promise<void> {
  const end = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > end) throw new Error('Condition timeout');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
