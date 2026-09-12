import { withIdentityAttempt, type Database } from '@daifuku/kernel';
import type { FastifyRequest } from 'fastify';
/** Only credential verification consumes failure budgets; unrelated reads and other auth purposes remain available. */
export function verifyAttempt<T>(owner: Database, request: FastifyRequest, purpose: string, work: () => Promise<T>, identity?: string): Promise<T> {
  const limits = [{ key: `verify-ip:${purpose}:${request.ip}`, limit: 100 }];
  if (identity) limits.push({ key: `verify-identity:${purpose}:${identity}`, limit: 10 });
  return withIdentityAttempt(owner, limits, work);
}
