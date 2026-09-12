// Pure form logic: field -> widget, record <-> form values, payload building, server issues -> field errors.
// No DOM here so it stays unit-testable (form.test.ts).
import type { Docstatus, EntityMeta, FieldMeta, RecordJson, ValidationIssue } from '../api/types.ts';

export type Widget = 'text' | 'textarea' | 'int' | 'decimal' | 'bool' | 'date' | 'timestamp' | 'enum' | 'ref' | 'json';

export type FormValue = string | boolean;
export type FormValues = Record<string, FormValue>;

export function widgetFor(field: FieldMeta): Widget {
  switch (field.kind) {
    case 'text':
      return field.multiline ? 'textarea' : 'text';
    case 'int':
      return 'int';
    case 'decimal':
      return 'decimal';
    case 'bool':
      return 'bool';
    case 'date':
      return 'date';
    case 'timestamp':
      return 'timestamp';
    case 'enum':
      return 'enum';
    case 'ref':
      return 'ref';
    case 'json':
      return 'json';
    default:
      // uuid and any kind added to the kernel later: a plain text box still round-trips the value.
      return 'text';
  }
}

/** Groups from `views.form`; 'auto' = every non-hidden field. Fields missing from explicit groups are appended so nothing becomes un-enterable. */
export function formGroups(entity: EntityMeta): FieldMeta[][] {
  const visible = entity.fields.filter((f) => !f.hidden);
  if (entity.views.form === 'auto') return [visible];
  const byName = new Map(visible.map((f) => [f.name, f] as const));
  const seen = new Set<string>();
  const groups: FieldMeta[][] = [];
  for (const names of entity.views.form) {
    const group: FieldMeta[] = [];
    for (const n of names) {
      const f = byName.get(n);
      if (!f || seen.has(n)) continue;
      seen.add(n);
      group.push(f);
    }
    if (group.length > 0) groups.push(group);
  }
  const rest = visible.filter((f) => !seen.has(f.name));
  if (rest.length > 0) groups.push(rest);
  return groups;
}

function toFormValue(field: FieldMeta, v: unknown): FormValue {
  if (v === null || v === undefined) return widgetFor(field) === 'bool' ? false : '';
  switch (widgetFor(field)) {
    case 'bool':
      return v === true;
    case 'json':
      return JSON.stringify(v, null, 2);
    case 'decimal':
      // numeric(20,6) comes back as "100.000000"; edit the canonical form (diffPatch compares canonically, so no spurious patch)
      return normalizeDecimalString(typeof v === 'string' ? v : String(v));
    default:
      return typeof v === 'string' ? v : String(v);
  }
}

export function initialValues(fields: readonly FieldMeta[], record?: Readonly<Record<string, unknown>>): FormValues {
  const out: FormValues = {};
  for (const f of fields) out[f.name] = toFormValue(f, record ? record[f.name] : f.defaultValue);
  return out;
}

export interface EditContext {
  mode: 'create' | 'update';
  docstatus?: Docstatus | undefined;
  allowOnSubmit?: readonly string[] | undefined;
}

/** AC-4/AC-5: timestamps are read-only; immutable fields lock after create; submitted docs allow only `allowOnSubmit`; cancelled docs are frozen. */
export function isFieldEditable(field: FieldMeta, ctx: EditContext): boolean {
  if (field.kind === 'timestamp' || field.serverOwned || field.readOnly) return false;
  if (ctx.mode === 'create') return true;
  if (field.immutable) return false;
  if (ctx.docstatus === 1) return (ctx.allowOnSubmit ?? []).includes(field.name);
  if (ctx.docstatus === 2) return false;
  return true;
}

const INT_RE = /^[+-]?\d+$/;
const DECIMAL_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** Canonical form of a decimal string so "10" and "10.000000" compare equal without leaving string-land (ADR-0010). */
export function normalizeDecimalString(s: string): string {
  const t = s.trim();
  if (!DECIMAL_RE.test(t)) return t;
  const neg = t.startsWith('-');
  let body = t.replace(/^[+-]/, '');
  const dot = body.indexOf('.');
  let intPart = dot === -1 ? body : body.slice(0, dot);
  let frac = dot === -1 ? '' : body.slice(dot + 1);
  intPart = intPart.replace(/^0+(?=\d)/, '') || '0';
  frac = frac.replace(/0+$/, '');
  body = frac ? `${intPart}.${frac}` : intPart;
  return neg && body !== '0' ? `-${body}` : body;
}

type Conversion = { ok: true; value: unknown } | { ok: false; error: string };

function convert(field: FieldMeta, raw: FormValue): Conversion {
  const widget = widgetFor(field);
  if (widget === 'bool') return { ok: true, value: raw === true };
  const s = typeof raw === 'string' ? raw : '';
  if (s.trim() === '') return { ok: true, value: null };
  switch (widget) {
    case 'int':
      return INT_RE.test(s.trim()) ? { ok: true, value: Number(s.trim()) } : { ok: false, error: 'integer expected' };
    case 'decimal':
      return DECIMAL_RE.test(s.trim()) ? { ok: true, value: normalizeDecimalString(s) } : { ok: false, error: 'number expected' };
    case 'json':
      try {
        return { ok: true, value: JSON.parse(s) };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'invalid JSON' };
      }
    case 'textarea':
      return { ok: true, value: s };
    default:
      return { ok: true, value: s.trim() };
  }
}

export interface PayloadResult {
  payload: Record<string, unknown>;
  errors: Record<string, string>;
}

/**
 * Form values -> API body. Empty create values are omitted (server defaults apply and required checks name the field);
 * empty update values become null (clearing). Timestamps are never sent. Decimal strings stay strings.
 */
export function toPayload(values: FormValues, fields: readonly FieldMeta[], mode: 'create' | 'update'): PayloadResult {
  const payload: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (f.kind === 'timestamp' || f.hidden || f.serverOwned || f.readOnly) continue;
    const raw = values[f.name];
    if (raw === undefined) continue;
    const c = convert(f, raw);
    if (!c.ok) {
      errors[f.name] = c.error;
      continue;
    }
    if (c.value === null && mode === 'create') continue;
    payload[f.name] = c.value;
  }
  return { payload, errors };
}

function sameValue(field: FieldMeta, a: unknown, b: unknown): boolean {
  if (field.kind === 'decimal' && typeof a === 'string' && typeof b === 'string') return normalizeDecimalString(a) === normalizeDecimalString(b);
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Only changed fields are sent on update: immutable fields untouched by the user must not appear in the patch. */
export function diffPatch(payload: Record<string, unknown>, original: RecordJson, fields: readonly FieldMeta[]): Record<string, unknown> {
  const byName = new Map(fields.map((f) => [f.name, f] as const));
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    const f = byName.get(k);
    if (!f) continue;
    if (!sameValue(f, v, original[k])) patch[k] = v;
  }
  return patch;
}

export interface FieldErrors {
  fieldErrors: Record<string, string>;
  formErrors: string[];
}

const WRAPPER_SEGMENTS = new Set(['patch', 'input', 'body']);

/** Field a path names: its first segment after a wrapper, or the dotted `ext.<key>` pair when that is a known field (web-phase15 AC-3). */
function fieldOfPath(path: string, known: ReadonlySet<string>): string | undefined {
  const segs = path.split('.').filter((s) => s.length > 0);
  const first = segs[0];
  const start = first !== undefined && WRAPPER_SEGMENTS.has(first) && segs.length > 1 ? 1 : 0;
  const head = segs[start];
  const pair = head !== undefined && segs[start + 1] !== undefined ? `${head}.${segs[start + 1] ?? ''}` : undefined;
  if (pair !== undefined && known.has(pair)) return pair;
  return head !== undefined && known.has(head) ? head : undefined;
}

/** Maps `details.issues[].path` (e.g. `patch.name`, `name`, `ext.foo`) to the owning field; unknown paths go to formErrors. */
export function issuesToFieldErrors(issues: readonly ValidationIssue[], fieldNames: readonly string[]): FieldErrors {
  const known = new Set(fieldNames);
  const fieldErrors: Record<string, string> = {};
  const formErrors: string[] = [];
  for (const issue of issues) {
    const head = fieldOfPath(issue.path, known);
    if (head !== undefined) {
      fieldErrors[head] = fieldErrors[head] ? `${fieldErrors[head]}; ${issue.message}` : issue.message;
    } else {
      formErrors.push(issue.path ? `${issue.path}: ${issue.message}` : issue.message);
    }
  }
  return { fieldErrors, formErrors };
}
