// docs/specs/event-delivery.md AC-1: worker settings are validated before connections open; messages name the variable,
// never its value.
import { describe, expect, it } from 'vitest';
import { ApiConfigError } from '../src/config.ts';
import { readEventWorkerConfig } from '../src/events/config.ts';

describe('event worker config', () => {
  it('AC-1 defaults: off, 10 s, 15 min, no loopback', () => {
    expect(readEventWorkerConfig({})).toEqual({
      enabled: false,
      intervalMs: 10000,
      inboxCheckMinutes: 15,
      allowLoopback: false,
    });
  });

  it('AC-1 accepts the documented ranges', () => {
    expect(
      readEventWorkerConfig({
        EVENT_WORKER_ENABLED: 'true',
        EVENT_WORKER_INTERVAL_MS: '1000',
        EVENT_INBOX_CHECK_MINUTES: '1440',
        EVENT_WEBHOOK_ALLOW_LOOPBACK: 'true',
        NODE_ENV: 'test',
      }),
    ).toEqual({ enabled: true, intervalMs: 1000, inboxCheckMinutes: 1440, allowLoopback: true });
    expect(
      readEventWorkerConfig({ EVENT_WORKER_INTERVAL_MS: '3600000', EVENT_INBOX_CHECK_MINUTES: '5' }),
    ).toMatchObject({
      intervalMs: 3600000,
      inboxCheckMinutes: 5,
    });
    expect(readEventWorkerConfig({ EVENT_WEBHOOK_ALLOW_LOOPBACK: 'true' }).allowLoopback).toBe(true);
  });

  it('AC-1 refuses invalid values without echoing them', () => {
    const cases: Record<string, string>[] = [
      { EVENT_WORKER_ENABLED: 'yes-secret-value' },
      { EVENT_WORKER_INTERVAL_MS: '999' },
      { EVENT_WORKER_INTERVAL_MS: '3600001' },
      { EVENT_WORKER_INTERVAL_MS: '10s-secret-value' },
      { EVENT_INBOX_CHECK_MINUTES: '4' },
      { EVENT_INBOX_CHECK_MINUTES: '1441' },
      { EVENT_WEBHOOK_ALLOW_LOOPBACK: 'TRUE-secret-value' },
    ];
    for (const env of cases) {
      const name = Object.keys(env)[0] ?? '';
      let error: unknown;
      try {
        readEventWorkerConfig(env);
      } catch (e) {
        error = e;
      }
      expect(error, name).toBeInstanceOf(ApiConfigError);
      expect((error as Error).message).toContain(name);
      expect((error as Error).message).not.toContain('secret-value');
    }
  });

  it('AC-1 loopback endpoints are allowed only in development and test (allow-list)', () => {
    for (const NODE_ENV of ['production', 'staging'])
      expect(() => readEventWorkerConfig({ EVENT_WEBHOOK_ALLOW_LOOPBACK: 'true', NODE_ENV })).toThrow(
        /EVENT_WEBHOOK_ALLOW_LOOPBACK.*development or test/,
      );
    expect(readEventWorkerConfig({ EVENT_WEBHOOK_ALLOW_LOOPBACK: 'false', NODE_ENV: 'production' }).allowLoopback).toBe(
      false,
    );
    expect(readEventWorkerConfig({ EVENT_WEBHOOK_ALLOW_LOOPBACK: 'true', NODE_ENV: 'development' }).allowLoopback).toBe(
      true,
    );
  });
});
