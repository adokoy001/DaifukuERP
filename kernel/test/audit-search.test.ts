// docs/specs/access-insight.md AC-8, AC-9, AC-11, AC-13, AC-15, AC-17 (no DB): the audit search query (each 400 reason,
// real dates, leap years, the 366-day limit counted with both ends), the Japanese business-date period, the opaque
// microsecond cursor and tampering, the access check before validation, the shared before/after filter (field groups
// and outputHidden, ext included), and a scan of the audit writers in kernel/modules/l10n/packs against AUDIT_SUBJECTS
// and AUDIT_OP_LABELS so a new subject or operation cannot go unnoticed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditSnapshotFilter } from '../src/audit.ts';
import {
  AUDIT_OP_LABELS,
  AUDIT_SEARCH_MIN_DATE,
  AUDIT_SUBJECTS,
  auditPeriod,
  auditPeriodDays,
  auditSearchOptions,
  auditSearchQuery,
  decodeAuditCursor,
  encodeAuditCursor,
  searchAudit,
  visibleAuditSubjects,
} from '../src/audit-search.ts';
import type { ContextParams, Db } from '../src/context.ts';
import { makeContext } from '../src/db/client.ts';
import { defineEntity } from '../src/dsl/entity.ts';
import { f } from '../src/dsl/fields.ts';
import { OPS } from '../src/dsl/types.ts';
import { PermissionDenied } from '../src/errors.ts';
import { label } from '../src/i18n.ts';
import { registry } from '../src/registry.ts';

const Secretive = defineEntity({
  name: 'asearch_secretive',
  label: label('監査検索の試験', 'Audit search test'),
  fields: {
    name: f.text({ required: true }),
    salary: f.decimal(),
    storageKey: f.text({ outputHidden: true }),
  },
  permissions: {
    roles: { hr: ['read'], clerk: ['read'] },
    fieldGroups: { pay: { fields: ['salary'], roles: ['hr'] } },
  },
});
registry.registerExt(Secretive.name, { token: f.text({ outputHidden: true }), tag: f.text() });

const BASE = { from: '2026-10-01', to: '2026-10-30' };
const issuesOf = (raw: unknown) => {
  const parsed = auditSearchQuery.safeParse(raw);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'));
};
const ctxOf = (params: Partial<ContextParams>) =>
  makeContext({} as unknown as Db, {
    tenantId: '00000000-0000-0000-0000-000000000001',
    companyId: '00000000-0000-0000-0000-0000000000c1',
    actor: { type: 'user', id: '00000000-0000-0000-0000-0000000000a1' },
    roles: ['admin'],
    ...params,
  });

describe('audit search query (access-insight AC-15)', () => {
  it('AC-15: a valid query gets its defaults (company scope, 50 rows)', () => {
    expect(auditSearchQuery.parse(BASE)).toEqual({ ...BASE, scope: 'company', limit: 50 });
    expect(auditSearchQuery.parse({ ...BASE, limit: '100', scope: 'tenant' })).toMatchObject({
      limit: 100,
      scope: 'tenant',
    });
  });

  it('AC-15: the period is required, must be real dates (leap years included) and from <= to', () => {
    expect(issuesOf({ to: BASE.to })).toEqual(['from']);
    expect(issuesOf({ from: BASE.from })).toEqual(['to']);
    expect(issuesOf({ from: '2025-02-29', to: '2025-03-01' })).toEqual(['from']);
    expect(issuesOf({ from: '2024-02-29', to: '2024-03-01' })).toEqual([]);
    expect(issuesOf({ from: '2026/10/01', to: BASE.to })).toEqual(['from']);
    expect(issuesOf({ from: '2026-10-31', to: '2026-10-30' })).toEqual(['to']);
  });

  it('AC-15: dates before AUDIT_SEARCH_MIN_DATE are refused (0001-01-01 would start in year 0, which Postgres rejects)', () => {
    expect(AUDIT_SEARCH_MIN_DATE).toBe('2000-01-01');
    expect(issuesOf({ from: '0001-01-01', to: '0001-01-02' })).toEqual(['from', 'to']);
    expect(issuesOf({ from: '1999-12-31', to: '2000-01-01' })).toEqual(['from']);
    expect(issuesOf({ from: '2000-01-01', to: '2000-01-01' })).toEqual([]);
    expect(issuesOf({ from: '9999-12-31', to: '9999-12-31' })).toEqual([]);
    const parsed = auditSearchQuery.safeParse({ from: '1999-12-31', to: '2000-01-01' });
    expect(parsed.success ? null : parsed.error.issues[0]?.message).toBe('Use a date on or after 2000-01-01.');
  });

  it('AC-15: at most 366 days counted with both ends: 2024-01-01..2024-12-31 passes, 2024-01-01..2025-01-01 fails', () => {
    expect(auditPeriodDays('2024-01-01', '2024-12-31')).toBe(366);
    expect(auditPeriodDays('2025-01-01', '2026-01-01')).toBe(366);
    expect(auditPeriodDays('2024-01-01', '2025-01-01')).toBe(367);
    expect(auditPeriodDays('2026-10-30', '2026-10-30')).toBe(1);
    expect(issuesOf({ from: '2024-01-01', to: '2024-12-31' })).toEqual([]);
    expect(issuesOf({ from: '2025-01-01', to: '2026-01-01' })).toEqual([]);
    expect(issuesOf({ from: '2024-01-01', to: '2025-01-01' })).toEqual(['to']);
  });

  it('AC-15: limit 1..100 integers, names, record id with entity, user id length, scope, unknown keys', () => {
    for (const limit of ['0', '101', 'abc', '1.5', '-1', 0, 101, 2.5])
      expect(issuesOf({ ...BASE, limit }), String(limit)).toEqual(['limit']);
    expect(issuesOf({ ...BASE, recordId: 'not-a-uuid', entity: 'partner' })).toEqual(['recordId']);
    expect(issuesOf({ ...BASE, recordId: '00000000-0000-4000-8000-000000000001' })).toEqual(['recordId']);
    expect(issuesOf({ ...BASE, recordId: '00000000-0000-4000-8000-000000000001', entity: 'partner' })).toEqual([]);
    expect(issuesOf({ ...BASE, entity: 'Partner' })).toEqual(['entity']);
    expect(issuesOf({ ...BASE, op: 'x'.repeat(65) })).toEqual(['op']);
    expect(issuesOf({ ...BASE, op: 'x'.repeat(64) })).toEqual([]);
    expect(issuesOf({ ...BASE, userId: '' })).toEqual(['userId']);
    expect(issuesOf({ ...BASE, userId: 'u'.repeat(201) })).toEqual(['userId']);
    expect(issuesOf({ ...BASE, userId: 'system' })).toEqual([]);
    expect(issuesOf({ ...BASE, scope: 'all' })).toEqual(['scope']);
    expect(issuesOf({ ...BASE, company: 'x' })).toEqual(['']);
    expect(issuesOf({ ...BASE, cursor: 'garbage!' })).toEqual(['cursor']);
  });
});

describe('audit period and cursor (access-insight AC-8, AC-9)', () => {
  it('AC-8: a period is Japanese business dates: [from 00:00+09:00, the day after to 00:00+09:00)', () => {
    const { start, end } = auditPeriod('2026-10-30', '2026-10-30');
    expect(start.toISOString()).toBe('2026-10-29T15:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-30T15:00:00.000Z');
    expect(auditPeriod('2024-02-28', '2024-02-29').end.toISOString()).toBe('2024-02-29T15:00:00.000Z');
  });

  it('AC-9: the cursor round-trips microseconds and rejects tampering', () => {
    const cursor = { at: '2026-10-30T01:02:03.123456Z', id: '00000000-0000-4000-8000-0000000000aa' };
    const raw = encodeAuditCursor(cursor);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeAuditCursor(raw)).toEqual(cursor);
    expect(issuesOf({ ...BASE, cursor: raw })).toEqual([]);
    const reencode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    expect(decodeAuditCursor(reencode(['2026-10-30T01:02:03.123Z', cursor.id]))).toBeNull();
    expect(decodeAuditCursor(reencode([cursor.at, 'not-a-uuid']))).toBeNull();
    expect(decodeAuditCursor(reencode({ at: cursor.at, id: cursor.id }))).toBeNull();
    expect(decodeAuditCursor(reencode([cursor.at, cursor.id, 'x']))).toBeNull();
    expect(decodeAuditCursor(`${raw.slice(0, -2)}`)).toBeNull();
    expect(decodeAuditCursor('a+b/c=')).toBeNull();
    expect(decodeAuditCursor('abc')).toBeNull();
  });

  it('AC-15: a cursor instant must be one Postgres accepts as it stands (no rolled-over day, no year 0)', () => {
    const reencode = (at: string) =>
      Buffer.from(JSON.stringify([at, '00000000-0000-4000-8000-0000000000aa'])).toString('base64url');
    // Date.parse('2026-02-30…') rolls over to March 2; Postgres answers "date/time field value out of range".
    expect(Number.isNaN(Date.parse('2026-02-30T00:00:00.000000Z'))).toBe(false);
    expect(decodeAuditCursor(reencode('2026-02-30T00:00:00.000000Z'))).toBeNull();
    expect(decodeAuditCursor(reencode('2026-10-30T24:00:00.000000Z'))).toBeNull();
    expect(decodeAuditCursor(reencode('0000-01-01T00:00:00.000000Z'))).toBeNull();
    expect(issuesOf({ ...BASE, cursor: reencode('2026-02-30T00:00:00.000000Z') })).toEqual(['cursor']);
    expect(issuesOf({ ...BASE, cursor: reencode('0000-01-01T00:00:00.000000Z') })).toEqual(['cursor']);
    for (const at of ['0001-01-01T00:00:00.000000Z', '2024-02-29T23:59:59.999999Z', '9999-12-31T23:59:59.999999Z'])
      expect(decodeAuditCursor(reencode(at))?.at, at).toBe(at);
  });
});

describe('audit search access order (access-insight AC-11)', () => {
  it('AC-11: access is checked before the query, so a non-admin with a malformed query gets 403, not 400', async () => {
    const malformed = { from: 'bad', limit: '0', extra: 1 };
    for (const ctx of [
      ctxOf({ roles: ['sales'] }),
      ctxOf({ accessScope: 'stores', storeIds: ['s'] }),
      ctxOf({ actor: { type: 'relay', id: 'gw' } }),
      ctxOf({ actor: { type: 'system', id: 'system' } }),
    ]) {
      await expect(searchAudit(ctx, malformed)).rejects.toBeInstanceOf(PermissionDenied);
      await expect(auditSearchOptions(ctx, { scope: 'nope' })).rejects.toBeInstanceOf(PermissionDenied);
    }
    await expect(searchAudit(ctxOf({}), malformed)).rejects.toMatchObject({ httpStatus: 400 });
    await expect(auditSearchOptions(ctxOf({}), { scope: 'nope' })).rejects.toMatchObject({ httpStatus: 400 });
  });

  it('AC-15: a company-scope search without a company is a 409 state error', async () => {
    await expect(searchAudit(ctxOf({ companyId: null }), BASE)).rejects.toMatchObject({ httpStatus: 409 });
  });
});

describe('visible audit subjects (access-insight AC-13, fail closed)', () => {
  it('AC-13: readable registry entities and the kernel subjects; never an unreadable entity or an unknown name', () => {
    const asAdmin = visibleAuditSubjects(ctxOf({}));
    expect(asAdmin).toEqual(expect.arrayContaining([Secretive.name, ...AUDIT_SUBJECTS.map((s) => s.name)]));
    expect(asAdmin).not.toContain('not_in_registry');
    expect(asAdmin).toEqual([...asAdmin].sort());
    const asClerk = visibleAuditSubjects(ctxOf({ roles: ['clerk'] }));
    expect(asClerk).toContain(Secretive.name);
    expect(visibleAuditSubjects(ctxOf({ roles: ['nobody'] }))).not.toContain(Secretive.name);
  });
});

describe('shared before/after filter (access-insight AC-13)', () => {
  const row = { name: 'A', salary: '100', storageKey: 'secret-key', ext: { token: 'secret-token', tag: 'ok' } };

  it('AC-13: a role outside the field group loses those fields; outputHidden (ext too) is removed for everyone', () => {
    expect(auditSnapshotFilter({ roles: ['clerk'] }, Secretive)(row)).toEqual({ name: 'A', ext: { tag: 'ok' } });
    expect(auditSnapshotFilter({ roles: ['hr'] }, Secretive)(row)).toEqual({
      name: 'A',
      salary: '100',
      ext: { tag: 'ok' },
    });
    expect(auditSnapshotFilter({ roles: ['admin'] }, Secretive)(row)).toEqual({
      name: 'A',
      salary: '100',
      ext: { tag: 'ok' },
    });
  });

  it('AC-13: kernel audit subjects (names outside the registry) are returned as stored; null and scalars become null', () => {
    const stored = { completed: true, storageKey: 'kept-for-kernel-subjects' };
    expect(auditSnapshotFilter({ roles: ['admin'] }, undefined)(stored)).toEqual(stored);
    expect(auditSnapshotFilter({ roles: ['admin'] }, Secretive)(null)).toBeNull();
    expect(auditSnapshotFilter({ roles: ['admin'] }, Secretive)('text')).toBeNull();
  });
});

// ---- AC-17: the audit writers and the subject / operation lists ------------------------------------------------------

const root = fileURLToPath(new URL('../../', import.meta.url));
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'node_modules' && name !== 'test') out.push(...sources(path));
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}
function sourceRoots(): string[] {
  const roots = [join(root, 'kernel/src')];
  for (const layer of ['modules', 'l10n', 'packs']) {
    const base = join(root, layer);
    for (const name of readdirSync(base)) {
      const src = join(base, name, 'src');
      try {
        if (statSync(src).isDirectory()) roots.push(src);
      } catch {
        // a package without src/
      }
    }
  }
  return roots;
}
/** Top-level arguments of each `fn(` call in the text (definitions `function fn(` are skipped). */
function callArgs(text: string, fn: string): string[][] {
  const out: string[][] = [];
  for (const m of text.matchAll(new RegExp(`(?<![\\w.])${fn}\\(`, 'g'))) {
    if (/function\s+$/.test(text.slice(Math.max(0, (m.index ?? 0) - 12), m.index))) continue;
    const args: string[] = [];
    let cur = '';
    let depth = 0;
    let quote: string | null = null;
    for (let j = (m.index ?? 0) + m[0].length; j < text.length; j++) {
      const c = text[j] as string;
      if (quote) {
        cur += c;
        if (c === quote && text[j - 1] !== '\\') quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        quote = c;
        cur += c;
        continue;
      }
      if ('([{'.includes(c)) depth += 1;
      if (')]}'.includes(c)) {
        if (depth === 0) {
          args.push(cur.trim());
          break;
        }
        depth -= 1;
      }
      if (c === ',' && depth === 0) {
        args.push(cur.trim());
        cur = '';
        continue;
      }
      cur += c;
    }
    out.push(args);
  }
  return out;
}
const literal = (arg: string | undefined) => /^'([a-z][a-z0-9_]*)'$/.exec(arg ?? '')?.[1];
/** Module-level string constants of a file (`const ENTITY = 'machine_credential';`), so a subject passed by name counts. */
const stringConstants = (text: string) =>
  new Map(
    [...text.matchAll(/^(?:export )?const ([A-Za-z_][A-Za-z0-9_]*) = '([a-z][a-z0-9_]*)';$/gm)].map(
      (m) => [m[1] as string, m[2] as string] as const,
    ),
  );
/** Operation literals of an argument: the whole argument or the branches of a conditional (`x ? 'a' : 'b'`). */
const opLiterals = (arg: string | undefined) =>
  [...(arg ?? '').matchAll(/(?:^|\?|:)\s*'([a-z][a-z0-9_]*)'/g)].map((m) => m[1] as string);

describe('audit subjects and operations (access-insight AC-17)', () => {
  const files = sourceRoots().flatMap(sources);
  const texts = files.map((path) => ({ path, text: readFileSync(path, 'utf8') }));
  const entityNames = new Set(
    texts.flatMap(({ text }) =>
      [...text.matchAll(/define(?:Entity|Document)\(\s*\{\s*name:\s*'([a-z][a-z0-9_]*)'/g)].map((m) => m[1] as string),
    ),
  );
  const subjects: { subject: string; scope: 'company' | 'tenant'; where: string }[] = [];
  const ops: { op: string; where: string }[] = [];
  for (const { path, text } of texts) {
    const where = path.slice(root.length);
    const constants = stringConstants(text);
    const subjectOf = (arg: string | undefined) => literal(arg) ?? constants.get(arg ?? '');
    for (const args of callArgs(text, 'writeAccessAudit')) {
      const subject = subjectOf(args[2]);
      if (subject) subjects.push({ subject, scope: args[1] === 'null' ? 'tenant' : 'company', where });
      for (const op of opLiterals(args[4])) ops.push({ op, where });
    }
    for (const args of callArgs(text, 'writeAudit')) {
      const subject = subjectOf(args[1]);
      if (subject && !entityNames.has(subject)) subjects.push({ subject, scope: 'company', where });
      for (const op of opLiterals(args[3])) ops.push({ op, where });
    }
    for (const args of callArgs(text, 'authAudit')) for (const op of opLiterals(args[2])) ops.push({ op, where });
  }

  it('AC-17: the scan finds the known writers (so an empty result cannot pass silently)', () => {
    expect(ops.map((o) => o.op)).toEqual(
      expect.arrayContaining(['supersede', 'pairing_issued', 'password_change', 'mfa_recovery_regenerated', 'export']),
    );
    // machine_credential is passed through a module constant (ENTITY), which the scan resolves.
    expect(subjects.map((s) => s.subject)).toEqual(
      expect.arrayContaining(['company_settings', 'relay', 'access_user', 'machine_credential']),
    );
  });

  it('AC-17: every literal subject written is in AUDIT_SUBJECTS with the matching scope', () => {
    const known = new Map(AUDIT_SUBJECTS.map((s) => [s.name, s.scope]));
    const missing = subjects.filter((s) => known.get(s.subject) !== s.scope);
    expect(missing, 'add these to AUDIT_SUBJECTS (kernel/src/audit-search.ts)').toEqual([]);
  });

  it('AC-17: every literal operation written has a label in AUDIT_OP_LABELS, and OPS are all labelled', () => {
    const missing = ops.filter((o) => !AUDIT_OP_LABELS[o.op]);
    expect(missing, 'add these to AUDIT_OP_LABELS (kernel/src/audit-search.ts)').toEqual([]);
    for (const op of OPS) expect(AUDIT_OP_LABELS[op], op).toBeDefined();
    for (const l of Object.values(AUDIT_OP_LABELS)) expect(l.ja && l.en).toBeTruthy();
  });
});
