// docs/specs/phase15-cleanup.md AC-3: domain operators compile with SQL's meaning — `$in: []` matches nothing, `$ne: null`
// is `IS NOT NULL`, a null element of `$in` adds `OR col IS NULL`. Before the fix `$in: []` compiled to `col = col` (every
// non-null row: a row rule with an empty list LIFTED the restriction) and `$ne: null` to `col <> col` (no row). No DB:
// the SQL text and parameters are rendered with drizzle's PgDialect. The DB behaviour is in permissions.db.test.ts.
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { Context, Db } from '../src/context.ts';
import { makeContext } from '../src/db/client.ts';
import { defineEntity } from '../src/dsl/entity.ts';
import { f } from '../src/dsl/fields.ts';
import type { Domain } from '../src/dsl/types.ts';
import { label } from '../src/i18n.ts';
import { compileDomain, rowFilter } from '../src/permissions.ts';
import { TPartner } from './fixtures/entities.ts';

const dialect = new PgDialect();
const rendered = (s: SQL | undefined) => (s === undefined ? undefined : (({ sql, params }) => ({ sql, params }))(dialect.sqlToQuery(s)));
const ctxOf = (roles: string[], companyId: string | null = null): Context =>
  makeContext({} as unknown as Db, { tenantId: '00000000-0000-0000-0000-000000000001', companyId, actor: { type: 'user', id: 'u-1' }, roles });
const compile = (domain: Domain, ctx: Context = ctxOf(['admin'])) => rendered(compileDomain(ctx, TPartner, domain));

const OWNER = '"test_partner"."owner_id"';
const KIND = '"test_partner"."kind"';

/** Row rules that use the three operators (roles are restricted only by these rules). */
const RuleItem = defineEntity({
  name: 'perm_unit_item',
  label: label('権限単体テスト', 'Permission unit item'),
  fields: { name: f.text({ required: true }), ownerId: f.uuid(), region: f.text() },
  permissions: {
    roles: { none_rule: ['read'], not_null_rule: ['read'], region_rule: ['read'], free: ['read'] },
    rowRules: [
      { roles: ['none_rule'], where: { region: { $in: [] } } },
      { roles: ['not_null_rule'], where: { ownerId: { $ne: null } } },
      { roles: ['region_rule'], where: { region: { $in: ['east', null] } } },
    ],
  },
});
const filterOf = (roles: string[]) => rendered(rowFilter(ctxOf(roles), RuleItem, 'read'));
const REGION = '"perm_unit_item"."region"';

describe('compileDomain operators (phase15-cleanup AC-3)', () => {
  it('$in: [] -> false (no row), not `col = col`', () => {
    expect(compile({ ownerId: { $in: [] } })).toEqual({ sql: 'false', params: [] });
    expect(compile({ kind: { $in: [] } })?.sql).not.toContain('=');
  });

  it('$ne: null -> col IS NOT NULL, not `col <> col`', () => {
    expect(compile({ ownerId: { $ne: null } })).toEqual({ sql: `${OWNER} is not null`, params: [] });
  });

  it('$in with a null element -> (col IN (non-null values) OR col IS NULL); only nulls -> col IS NULL', () => {
    expect(compile({ kind: { $in: ['customer', null] } })).toEqual({ sql: `(${KIND} in ($1) or ${KIND} is null)`, params: ['customer'] });
    expect(compile({ kind: { $in: [null, 'customer', 'both'] } })).toEqual({ sql: `(${KIND} in ($1, $2) or ${KIND} is null)`, params: ['customer', 'both'] });
    expect(compile({ kind: { $in: [null] } })).toEqual({ sql: `${KIND} is null`, params: [] });
    expect(compile({ kind: { $in: [null, null] } })).toEqual({ sql: `${KIND} is null`, params: [] });
  });

  it('$ctx tokens that resolve to null follow the same rules as a literal null', () => {
    const noCompany = ctxOf(['admin'], null);
    expect(compile({ ownerId: { $ne: '$ctx.companyId' } }, noCompany)).toEqual({ sql: `${OWNER} is not null`, params: [] });
    expect(compile({ ownerId: { $in: ['$ctx.companyId'] } }, noCompany)).toEqual({ sql: `${OWNER} is null`, params: [] });
    expect(compile({ ownerId: { $in: ['$ctx.userId', '$ctx.companyId'] } }, noCompany)).toEqual({ sql: `(${OWNER} in ($1) or ${OWNER} is null)`, params: ['u-1'] });
    const withCompany = ctxOf(['admin'], 'c-1');
    expect(compile({ ownerId: { $ne: '$ctx.companyId' } }, withCompany)).toEqual({ sql: `${OWNER} <> $1`, params: ['c-1'] });
  });

  it('unchanged operators: equality, null, $in without nulls, $ne with a value, ranges, $like, $or', () => {
    expect(compile({ kind: 'customer' })).toEqual({ sql: `${KIND} = $1`, params: ['customer'] });
    expect(compile({ ownerId: null })).toEqual({ sql: `${OWNER} is null`, params: [] });
    expect(compile({ kind: { $in: ['customer', 'both'] } })).toEqual({ sql: `${KIND} in ($1, $2)`, params: ['customer', 'both'] });
    expect(compile({ kind: { $ne: 'customer' } })).toEqual({ sql: `${KIND} <> $1`, params: ['customer'] });
    expect(compile({ since: { $gte: '2026-01-01' } })).toEqual({ sql: '"test_partner"."since" >= $1', params: ['2026-01-01'] });
    expect(compile({ name: { $like: 'A%' } })).toEqual({ sql: '"test_partner"."name" like $1', params: ['A%'] });
    expect(compile({ $or: [{ ownerId: '$ctx.userId' }, { ownerId: null }] })).toEqual({ sql: `(${OWNER} = $1 or ${OWNER} is null)`, params: ['u-1'] });
    expect(compile({})).toBeUndefined();
  });
});

describe('rowFilter with the fixed operators (phase15-cleanup AC-3)', () => {
  it('a rule `$in: []` restricts the role to no row (it used to compile to `col = col` and expose every non-null row)', () => {
    expect(filterOf(['none_rule'])).toEqual({ sql: 'false', params: [] });
  });

  it('a rule `$ne: null` keeps the rows where the column is set (it used to compile to `col <> col` and hide every row)', () => {
    expect(filterOf(['not_null_rule'])).toEqual({ sql: '"perm_unit_item"."owner_id" is not null', params: [] });
  });

  it('a rule `$in: [value, null]` keeps the value and the unset rows', () => {
    expect(filterOf(['region_rule'])).toEqual({ sql: `(${REGION} in ($1) or ${REGION} is null)`, params: ['east'] });
  });

  it('restricted roles OR their rules; an unrestricted role or admin removes the filter', () => {
    expect(filterOf(['none_rule', 'region_rule'])).toEqual({ sql: `(false or (${REGION} in ($1) or ${REGION} is null))`, params: ['east'] });
    expect(filterOf(['none_rule', 'free'])).toBeUndefined();
    expect(filterOf(['admin'])).toBeUndefined();
  });
});
