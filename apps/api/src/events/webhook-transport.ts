// Webhook HTTP adapter (docs/specs/event-delivery.md AC-9, AC-13; ADR-0037). Resolves the endpoint host once, refuses
// any address that is not globally routable unicast (IPv4-mapped IPv6 is checked as IPv4; NAT64, 6to4, Teredo and the
// documentation ranges are refused outright), then connects to the checked address only (no second lookup), with TLS
// verification, a 10 s limit, no redirects and at most 64 KiB of the response read and discarded. Loopback URLs connect
// to loopback only, and only when EVENT_WEBHOOK_ALLOW_LOOPBACK is on (development and test). The 10 s limit and the
// shutdown abort cover name resolution too: DNS names are resolved with c-ares (no libuv threadpool thread is held by a
// slow DNS server) and the query is cancelled when the attempt times out or the process stops.
import { lookup, Resolver } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import {
  isLoopbackWebhookUrl,
  webhookUrlProblem,
  type WebhookOutcome,
  type WebhookRequest,
  type WebhookTransport,
} from '@daifuku/kernel';

export type AddressClass = 'global' | 'loopback' | 'blocked';
export interface ResolvedAddress {
  address: string;
  family: number;
}

/** IPv4 ranges that are never a webhook destination (besides 127.0.0.0/8, classified as loopback). */
const BLOCKED_V4: readonly [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
/** Inside 2000::/3 (global unicast), the ranges that embed IPv4, are reserved for protocols or for documentation. */
const BLOCKED_V6_IN_GLOBAL: readonly [string, number][] = [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
];

function parseV4(text: string): number | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    value = value * 256 + Number(part);
  }
  return value;
}

function parseV6(text: string): bigint | null {
  let input = text.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const groups: number[] = [];
  const tail = input.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail?.[1]) {
    const v4 = parseV4(tail[1]);
    if (v4 === null) return null;
    input = `${input.slice(0, -tail[1].length)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = input.split('::');
  if (halves.length > 2) return null;
  const read = (part: string | undefined) =>
    part ? part.split(':').map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : Number.NaN)) : [];
  const head = read(halves[0]);
  const rest = read(halves[1]);
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups.push(...head, ...Array<number>(fill).fill(0), ...rest);
  } else groups.push(...head);
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g))) return null;
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);
}

function inV4(value: number, [net, bits]: readonly [string, number]): boolean {
  const base = parseV4(net) ?? 0;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) >>> 0 === (base & mask) >>> 0;
}

function inV6(value: bigint, [net, bits]: readonly [string, number]): boolean {
  const base = parseV6(net) ?? 0n;
  const shift = BigInt(128 - bits);
  return value >> shift === base >> shift;
}

function classifyV4(value: number): AddressClass {
  if (inV4(value, ['127.0.0.0', 8])) return 'loopback';
  return BLOCKED_V4.some((range) => inV4(value, range)) ? 'blocked' : 'global';
}

/** The IPv4 form of an IPv4-mapped IPv6 address (::ffff:a.b.c.d), else null. */
function mappedV4(value: bigint): number | null {
  return value >> 32n === 0xffffn ? Number(value & 0xffffffffn) : null;
}

/**
 * Allow-list check of one resolved address (AC-13): `global` only for globally routable unicast, `loopback` for
 * 127.0.0.0/8 and ::1, `blocked` for everything else (private, link-local, CGNAT, unique-local, multicast, reserved,
 * documentation, unspecified, IPv4-compatible, NAT64, 6to4, Teredo).
 */
export function classifyAddress(address: string): AddressClass {
  const v4 = parseV4(address);
  if (v4 !== null) return classifyV4(v4);
  const v6 = parseV6(address);
  if (v6 === null) return 'blocked';
  const mapped = mappedV4(v6);
  if (mapped !== null) return classifyV4(mapped);
  if (v6 === 1n) return 'loopback';
  if (!inV6(v6, ['2000::', 3])) return 'blocked';
  return BLOCKED_V6_IN_GLOBAL.some((range) => inV6(v6, range)) ? 'blocked' : 'global';
}

/** The address to connect to: IPv4-mapped IPv6 as plain IPv4. */
function connectAddress(resolved: ResolvedAddress): ResolvedAddress {
  const v6 = resolved.family === 6 ? parseV6(resolved.address) : null;
  const mapped = v6 === null ? null : mappedV4(v6);
  if (mapped === null) return resolved;
  return { address: [24, 16, 8, 0].map((shift) => (mapped >>> shift) & 255).join('.'), family: 4 };
}

const TLS_ERROR = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|HOSTNAME|ALTNAME/i;

export interface WebhookTransportOptions {
  allowLoopback: boolean;
  /**
   * Name resolution (injected by tests). The default resolves DNS names with c-ares (A and AAAA, every address) and
   * cancels the query on `signal`; `localhost` (a development loopback URL) goes through the system resolver.
   */
  resolve?: (hostname: string, signal: AbortSignal) => Promise<ResolvedAddress[]>;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Extra TLS trust for tests; production uses the system store. */
  ca?: string;
}

const blocked: WebhookOutcome = { ok: false, code: 'blocked_destination' };
const timedOut: WebhookOutcome = { ok: false, code: 'timeout' };

/** A/AAAA lookup with c-ares: bounded by the attempt's signal, cancelled on abort, no threadpool thread. */
async function resolveDns(hostname: string, signal: AbortSignal, timeoutMs: number): Promise<ResolvedAddress[]> {
  if (hostname.toLowerCase() === 'localhost')
    return (await lookup(hostname, { all: true, verbatim: true })).map((a) => ({
      address: a.address,
      family: a.family,
    }));
  const resolver = new Resolver({ timeout: Math.max(100, Math.floor(timeoutMs / 2)), tries: 2 });
  const cancel = () => resolver.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const [v4, v6] = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
    const addresses = [
      ...(v4.status === 'fulfilled' ? v4.value.map((address) => ({ address, family: 4 })) : []),
      ...(v6.status === 'fulfilled' ? v6.value.map((address) => ({ address, family: 6 })) : []),
    ];
    if (addresses.length === 0) throw new Error('no address');
    return addresses;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

/** Resolves `work`, or null as soon as `signal` aborts (the work is then abandoned). */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise<T | null>((resolve, reject) => {
    const onAbort = () => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error('resolution failed'));
      },
    );
  });
}

export function webhookTransport(options: WebhookTransportOptions): WebhookTransport {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const resolve = options.resolve ?? ((hostname, signal) => resolveDns(hostname, signal, timeoutMs));
  const maxResponseBytes = options.maxResponseBytes ?? 64 * 1024;
  return {
    async send(request: WebhookRequest): Promise<WebhookOutcome> {
      let url: URL;
      try {
        url = new URL(request.url);
      } catch {
        return blocked;
      }
      const loopbackUrl = isLoopbackWebhookUrl(url);
      if (loopbackUrl ? !options.allowLoopback : webhookUrlProblem(request.url) !== null) return blocked;
      if (url.protocol !== 'https:' && !(loopbackUrl && url.protocol === 'http:')) return blocked;
      // One limit for the whole attempt, name resolution included (AC-9); the shutdown signal aborts it too (AC-1).
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
      const host = url.hostname.replace(/^\[|\]$/g, '');
      let addresses: ResolvedAddress[] | null;
      try {
        addresses = isIP(host)
          ? [{ address: host, family: isIP(host) }]
          : await untilAborted(resolve(host, signal), signal);
      } catch {
        return signal.aborted ? timedOut : { ok: false, code: 'network' };
      }
      if (addresses === null) return timedOut;
      if (addresses.length === 0) return { ok: false, code: 'network' };
      const classes = addresses.map((a) => classifyAddress(a.address));
      // A DNS name that resolves to loopback is refused whatever the flag says; a loopback URL reaches loopback only.
      if (loopbackUrl ? classes.some((c) => c !== 'loopback') : classes.some((c) => c !== 'global')) return blocked;
      const target = connectAddress(addresses[0] as ResolvedAddress);
      return post(url, target, request, signal, timeout, {
        maxResponseBytes,
        ...(options.ca ? { ca: options.ca } : {}),
      });
    },
  };
}

function post(
  url: URL,
  target: ResolvedAddress,
  request: WebhookRequest,
  signal: AbortSignal,
  timeout: AbortSignal,
  limits: { maxResponseBytes: number; ca?: string },
): Promise<WebhookOutcome> {
  const body = Buffer.from(request.body, 'utf8');
  const secure = url.protocol === 'https:';
  return new Promise<WebhookOutcome>((resolveOutcome) => {
    let settled = false;
    const done = (outcome: WebhookOutcome) => {
      if (settled) return;
      settled = true;
      resolveOutcome(outcome);
    };
    const options: https.RequestOptions = {
      method: 'POST',
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port || (secure ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers: { ...request.headers, 'content-length': String(body.length) },
      agent: false,
      signal,
      // Connect to the address that was checked; never resolve the name a second time.
      lookup: (_hostname, opts, callback) => {
        if ((opts as { all?: boolean }).all) callback(null, [{ address: target.address, family: target.family }]);
        else callback(null, target.address, target.family);
      },
      ...(secure
        ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true, ...(limits.ca ? { ca: limits.ca } : {}) }
        : {}),
    };
    const req = (secure ? https : http).request(options, (res) => {
      const status = res.statusCode ?? 0;
      const outcome: WebhookOutcome =
        status >= 200 && status < 300
          ? { ok: true, status }
          : status >= 300 && status < 400
            ? { ok: false, code: 'redirect', status }
            : { ok: false, code: 'http_status', status };
      let read = 0;
      res.on('data', (chunk: Buffer) => {
        read += chunk.length;
        if (read > limits.maxResponseBytes) {
          res.destroy();
          done(outcome);
        }
      });
      res.on('end', () => done(outcome));
      res.on('error', () => done(outcome));
      res.on('close', () => done(outcome));
    });
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (timeout.aborted) return done({ ok: false, code: 'timeout' });
      const code = typeof error.code === 'string' ? error.code : '';
      done({ ok: false, code: TLS_ERROR.test(code) ? 'tls' : 'network' });
    });
    req.end(body);
  });
}
