// Error handler (docs/conventions/errors.md): every failure is `{ error: { code, message, hint, details } }`.
// DaifukuError carries its own status; Fastify/zod validation and JWT failures are mapped to the same shape.
import { DaifukuError, safeErrorDiagnostics, toErrorBody, type ErrorBody, type ErrorCode } from '@daifuku/kernel';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

function codeForStatus(status: number): ErrorCode {
  if (status === 400) return 'VALIDATION';
  if (status === 401 || status === 403) return 'PERMISSION_DENIED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  return 'INTERNAL';
}

export function mapError(err: unknown, requestId: string): { status: number; body: ErrorBody } {
  if (err instanceof DaifukuError) return toErrorBody(err);
  if (hasZodFastifySchemaValidationErrors(err)) {
    const issues = err.validation.map((v) => ({ path: v.instancePath.replace(/^\//, '').replace(/\//g, '.'), message: v.message ?? 'invalid' }));
    return { status: 400, body: { code: 'VALIDATION', message: 'invalid request', hint: 'Fix the listed fields and retry.', details: { issues } } };
  }
  const fe: Partial<FastifyError> = err !== null && typeof err === 'object' ? err : {};
  const status = typeof fe.statusCode === 'number' ? fe.statusCode : 500;
  if (status >= 400 && status < 500) {
    const code = codeForStatus(status);
    const hint = status === 401 ? 'Log in with POST /auth/login and send `Authorization: Bearer <token>`.' : status === 400 ? 'Check the request body, query and headers.' : 'Check the request.';
    const message = status === 401 ? 'Authentication required.' : status === 403 ? 'Operation not permitted.' : status === 404 ? 'Resource not found.' : 'Invalid request.';
    const body: ErrorBody = { code, message, hint, details: { requestId } };
    return { status, body };
  }
  const base = toErrorBody(err);
  return { status: base.status, body: { ...base.body, details: { requestId } } };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    const { status, body } = mapError(err, req.id);
    if (status >= 500) req.log.error({ ...safeErrorDiagnostics(err), requestId: req.id }, 'unhandled error');
    void reply.status(status).send({ error: body });
  });
  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    const body: ErrorBody = {
      code: 'NOT_FOUND',
      message: `route ${req.method} ${req.url} does not exist`,
      hint: 'See /openapi.json for the available routes, or GET /meta for entities and actions.',
    };
    void reply.status(404).send({ error: body });
  });
}
