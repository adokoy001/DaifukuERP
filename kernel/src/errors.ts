// Error model (docs/conventions/errors.md). Every error carries a `hint`: what the caller should do next.

export type ErrorCode =
  | 'VALIDATION'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'HAS_DEPENDENTS'
  | 'INTERNAL';

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  hint: string;
  details?: Record<string, unknown>;
}

export class DaifukuError extends Error {
  readonly code: ErrorCode;
  readonly hint: string;
  readonly details: Record<string, unknown> | undefined;
  readonly httpStatus: number;

  constructor(code: ErrorCode, message: string, hint: string, details?: Record<string, unknown>, httpStatus = 500) {
    super(message);
    this.name = 'DaifukuError';
    this.code = code;
    this.hint = hint;
    this.details = details;
    this.httpStatus = httpStatus;
  }

  toBody(): ErrorBody {
    const body: ErrorBody = { code: this.code, message: this.message, hint: this.hint };
    if (this.details) body.details = this.details;
    return body;
  }
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export class ValidationError extends DaifukuError {
  constructor(message: string, issues: ValidationIssue[], hint = 'Fix the listed fields and retry.') {
    super('VALIDATION', message, hint, { issues }, 400);
    this.name = 'ValidationError';
  }
}

export class PermissionDenied extends DaifukuError {
  constructor(entity: string, op: string, roles: readonly string[]) {
    super(
      'PERMISSION_DENIED',
      `Operation "${op}" on "${entity}" is not permitted for roles [${roles.join(', ')}]`,
      `Use a context whose roles include one granted "${op}" on "${entity}" (see the entity's permissions block). There is no bypass flag (ADR-0007).`,
      { entity, op, roles: [...roles] },
      403,
    );
    this.name = 'PermissionDenied';
  }
}

export class NotFound extends DaifukuError {
  constructor(entity: string, id: string) {
    super('NOT_FOUND', `${entity} ${id} not found`, `Check the id, and that the current context (tenant/company/roles) may see this record.`, { entity, id }, 404);
    this.name = 'NotFound';
  }
}

export class Conflict extends DaifukuError {
  constructor(message: string, hint: string, details?: Record<string, unknown>) {
    super('CONFLICT', message, hint, details, 409);
    this.name = 'Conflict';
  }
}

export class StateError extends DaifukuError {
  constructor(message: string, hint: string, details?: Record<string, unknown>) {
    super('INVALID_STATE', message, hint, details, 409);
    this.name = 'StateError';
  }
}

export class DependencyError extends DaifukuError {
  /** `override` reuses the class for a missing definition-time dependency (e.g. registerExt on an unregistered entity). */
  constructor(entity: string, id: string, dependents: Array<{ entity: string; id: string }>, override?: { message: string; hint: string }) {
    super(
      'HAS_DEPENDENTS',
      override?.message ?? `${entity} ${id} has ${dependents.length} dependent submitted document(s)`,
      override?.hint ?? 'Cancel the dependent documents first (listed in details.dependents), then retry.',
      { entity, id, dependents },
      409,
    );
    this.name = 'DependencyError';
  }
}

export function toErrorBody(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof DaifukuError) return { status: err.httpStatus, body: err.toBody() };
  const message = err instanceof Error ? err.message : String(err);
  return { status: 500, body: { code: 'INTERNAL', message, hint: 'This is a bug. Check server logs with the request id.' } };
}
