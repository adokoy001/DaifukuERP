// Event delivery worker settings (docs/specs/event-delivery.md AC-1). Validated before any connection is opened; error
// messages name the variable and the rule, never the supplied value.
import { ApiConfigError } from '../config.ts';

type Environment = Readonly<Record<string, string | undefined>>;

export interface EventWorkerConfig {
  /** EVENT_WORKER_ENABLED=true starts the periodic worker in this API process (default off). */
  enabled: boolean;
  /** EVENT_WORKER_INTERVAL_MS: pause between the end of one tick and the start of the next (1000..3600000). */
  intervalMs: number;
  /** EVENT_INBOX_CHECK_MINUTES: how often one user's inbox is counted at most (5..1440). */
  inboxCheckMinutes: number;
  /** EVENT_WEBHOOK_ALLOW_LOOPBACK=true lets loopback endpoint URLs connect to loopback (development and test only). */
  allowLoopback: boolean;
}

export const DEFAULT_EVENT_WORKER: EventWorkerConfig = {
  enabled: false,
  intervalMs: 10_000,
  inboxCheckMinutes: 15,
  allowLoopback: false,
};

function flag(env: Environment, name: string): boolean {
  const value = env[name];
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ApiConfigError(`${name} must be true or false`);
}

function integer(env: Environment, name: string, min: number, max: number, fallback: number): number {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max)
    throw new ApiConfigError(`${name} must be an integer from ${min} to ${max}`);
  return Number(value);
}

export function readEventWorkerConfig(env: Environment): EventWorkerConfig {
  const enabled = flag(env, 'EVENT_WORKER_ENABLED');
  const intervalMs = integer(env, 'EVENT_WORKER_INTERVAL_MS', 1000, 3_600_000, DEFAULT_EVENT_WORKER.intervalMs);
  const inboxCheckMinutes = integer(env, 'EVENT_INBOX_CHECK_MINUTES', 5, 1440, DEFAULT_EVENT_WORKER.inboxCheckMinutes);
  const allowLoopback = flag(env, 'EVENT_WEBHOOK_ALLOW_LOOPBACK');
  // Allow-list like the identity loopback rule: only development and test may connect to loopback endpoints.
  if (allowLoopback && !['development', 'test'].includes(env.NODE_ENV ?? 'development'))
    throw new ApiConfigError('EVENT_WEBHOOK_ALLOW_LOOPBACK=true is allowed only when NODE_ENV is development or test');
  return { enabled, intervalMs, inboxCheckMinutes, allowLoopback };
}
