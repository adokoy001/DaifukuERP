import { Conflict, safeErrorDiagnostics, toErrorBody } from '@daifuku/kernel';
import fastify, { LogController } from 'fastify';
import { describe, expect, it } from 'vitest';
import { mapError, registerErrorHandler } from '../src/plugins/errors.ts';
import { registerRequestLog } from '../src/plugins/request-log.ts';

const SECRET = 'private-password-payroll-identifier';
function databaseError(code: string) {
  return new Error(`Failed query: select password_hash from users; params: ${SECRET}`, { cause: { code, detail: `Key (private_value)=(${SECRET}) already exists`, query: SECRET } });
}

describe('quality-foundation AC-1: public errors and operational logs', () => {
  it('keeps intentional business errors and redacts unknown errors and unique values', () => {
    const known = new Conflict('Version changed', 'Reload the record.', { expected: 1 });
    expect(toErrorBody(known)).toEqual({ status: 409, body: known.toBody() });
    for (const failure of [databaseError('23503'), new Error(SECRET), SECRET, null, undefined, { message: SECRET }]) {
      const result = mapError(failure, 'req-safe');
      expect(result).toMatchObject({ status: 500, body: { code: 'INTERNAL', details: { requestId: 'req-safe' } } });
      expect(JSON.stringify(result)).not.toContain(SECRET);
    }
    for (const failure of [databaseError('23505'), { code: '23505', detail: SECRET }]) {
      expect(mapError(failure, 'req-conflict')).toMatchObject({ status: 409, body: { code: 'CONFLICT', details: { requestId: 'req-conflict' } } });
      expect(JSON.stringify(mapError(failure, 'req-conflict'))).not.toContain(SECRET);
    }
  });

  it('retains only diagnostic SQLSTATE, including nested database causes', () => {
    expect(safeErrorDiagnostics(new Error(SECRET, { cause: databaseError('23503') }))).toEqual({ category: 'database', sqlState: '23503' });
    expect(safeErrorDiagnostics({ name: SECRET, message: SECRET, code: SECRET, stack: SECRET })).toEqual({ category: 'unexpected' });
  });

  it('does not echo framework parser messages containing request input', () => {
    expect(mapError(Object.assign(new Error(SECRET), { statusCode: 400, code: SECRET }), 'bad-json')).toEqual({ status: 400, body: { code: 'VALIDATION', message: 'Invalid request.', hint: 'Check the request body, query and headers.', details: { requestId: 'bad-json' } } });
  });

  it('returns traceable errors and logs neither SQL/stack/body nor query values', async () => {
    const logs: string[] = [];
    const app = fastify({ logger: { stream: { write: (line: string) => void logs.push(line) } }, logController: new LogController({ disableRequestLogging: true }) });
    registerErrorHandler(app);
    registerRequestLog(app);
    app.post('/failure', async () => { throw databaseError('23503'); });
    try {
      const res = await app.inject({ method: 'POST', url: `/failure?search=${SECRET}`, payload: { password: SECRET } });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toMatchObject({ error: { code: 'INTERNAL', details: { requestId: expect.any(String) } } });
      expect(res.body).not.toContain(SECRET);
      expect(logs.join('')).not.toContain(SECRET);
      expect(logs.join('')).not.toContain('Failed query');
      expect(logs.join('')).not.toContain('password_hash');
      expect(logs.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([expect.objectContaining({ msg: 'unhandled error', category: 'database', sqlState: '23503' }), expect.objectContaining({ msg: 'request', url: '/failure' })]));
    } finally { await app.close(); }
  });
});
