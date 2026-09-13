import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { extEqualityColumnName, extEqualityIndexName, extTextExpression } from '../src/db/ext-index.ts';
import { currentSnapshot, diffSql } from '../src/db/schema-sync.ts';
import { defineEntity } from '../src/dsl/entity.ts';
import { f, type AnyField } from '../src/dsl/fields.ts';
import type { DomainCondition } from '../src/dsl/types.ts';
import { label } from '../src/i18n.ts';
import { registry } from '../src/registry.ts';
import { compileExtCondition, extSearchConditions } from '../src/repository/ext-query.ts';

const CompanyItem = defineEntity({
  name: 'ext_index_company',
  label: label('索引', 'Index'),
  fields: { name: f.text() },
  permissions: { roles: { reader: ['read'] } },
});
const TenantItem = defineEntity({
  name: 'ext_index_tenant',
  scope: 'tenant',
  label: label('索引', 'Index'),
  fields: { name: f.text() },
  permissions: { roles: { reader: ['read'] } },
});
const dialect = new PgDialect();
const before = currentSnapshot();
registry.registerExt(CompanyItem.name, {
  jan: f.text({ equalityIndex: true, searchable: true }),
  note: f.text({ searchable: true }),
});
registry.registerExt(TenantItem.name, { accountKey: f.text({ equalityIndex: true }) });
const compile = (condition: DomainCondition) =>
  dialect.sqlToQuery(compileExtCondition(CompanyItem, 'ext.jan', condition, (value) => value));

describe('declarative ext equality indexes (review-hardening AC-3)', () => {
  it('late registrations generate only scoped nonunique indexes without replacing table identity', async () => {
    const table = CompanyItem.table;
    const after = currentSnapshot();
    const statements = await diffSql(before, after);
    expect(statements).toHaveLength(4);
    expect(statements.filter((statement) => statement.startsWith('CREATE INDEX'))).toHaveLength(2);
    const columns = statements.filter((statement) => statement.startsWith('ALTER TABLE'));
    expect(columns).toHaveLength(2);
    expect(columns.every((statement) => statement.includes('GENERATED ALWAYS AS (left('))).toBe(true);
    const companySql = statements.find((statement) =>
      statement.includes(extEqualityIndexName(CompanyItem.name, 'jan')),
    );
    expect(companySql).toContain(`USING btree ("tenant_id","company_id","${extEqualityColumnName('jan')}")`);
    expect(columns.find((statement) => statement.includes(CompanyItem.name))).toContain("->> 'jan'");
    expect(columns[0]).toContain(', 128)');
    const tenantSql = statements.find((statement) =>
      statement.includes(extEqualityIndexName(TenantItem.name, 'accountKey')),
    );
    expect(tenantSql).toContain(`USING btree ("tenant_id","${extEqualityColumnName('accountKey')}")`);
    expect(tenantSql).not.toContain('company_id');
    expect(CompanyItem.table).toBe(table);
    expect(CompanyItem.columns).not.toHaveProperty(extEqualityColumnName('jan'));
    expect(await diffSql(after, currentSnapshot())).toEqual([]);
  });

  it('keeps a validated literal key and parameterized full values for prepared queries', () => {
    const maliciousValue = "00123' OR true --";
    const rendered = compile(maliciousValue);
    expect(rendered.sql).toContain("->> 'jan'");
    expect(rendered.sql).toContain('left($1, 128)');
    expect(rendered.sql).toContain('= $2');
    expect(rendered.sql).not.toContain(maliciousValue);
    expect(rendered.params).toEqual([maliciousValue, maliciousValue]);
    expect(() => extTextExpression(CompanyItem.col('ext'), "jan' OR true --")).toThrow('Invalid registered ext key');
  });

  it('IN retains the full comparison, null bucket and empty-set semantics', () => {
    const rendered = compile({ $in: ['00123', '00124', null] });
    expect(rendered.params).toEqual(['00123', '00124', '00123', '00124']);
    expect(rendered.sql).toContain('in (left($1, 128), left($2, 128))');
    expect(rendered.sql).toContain('in ($3, $4)');
    expect(rendered.sql).toContain('is null');
    expect(compile({ $in: [] })).toMatchObject({ sql: 'false', params: [] });
    expect(compile(null).sql).toContain('is null');
  });

  it('negative and fuzzy conditions keep their existing full-value semantics', () => {
    expect(compile({ $ne: '00123' }).sql).not.toContain('left(');
    expect(compile({ $ne: null }).sql).not.toContain('left(');
    expect(compile({ $like: '%123%' }).sql).not.toContain('left(');
    const search = extSearchConditions(CompanyItem, '123').map((term) => dialect.sqlToQuery(term));
    expect(search).toHaveLength(2);
    expect(search.every((term) => term.sql.includes('ilike') && !term.sql.includes('left('))).toBe(true);
    expect(() => compile({ $gt: '00123' })).toThrow('unsupported condition');
  });

  it.each([
    f.int({ equalityIndex: true } as never),
    f.text({ equalityIndex: 'yes' } as never),
    f.text({ equalityIndex: true, unique: true }),
  ])('rejects invalid index declarations without partially registering fields', (field) => {
    expect(() => registry.registerExt(CompanyItem.name, { valid: f.text(), bad: field as AnyField })).toThrow();
    expect(registry.extFields(CompanyItem.name).map((def) => def.key)).toEqual(['jan', 'note']);
  });

  it('refuses ext equality flags on physical columns and bounds stable index identifiers', () => {
    expect(() =>
      defineEntity({
        name: 'ext_index_invalid',
        label: label('索引', 'Index'),
        fields: { name: f.text({ equalityIndex: true }) },
        permissions: { roles: { reader: ['read'] } },
      }),
    ).toThrow('use index');
    const entity = 'entity_'.repeat(12);
    const first = extEqualityIndexName(entity, 'a'.repeat(100));
    const second = extEqualityIndexName(entity, `${'a'.repeat(99)}b`);
    expect(Buffer.byteLength(first)).toBeLessThanOrEqual(63);
    expect(second).not.toBe(first);
    expect(extEqualityIndexName(entity, 'a'.repeat(100))).toBe(first);
  });
});
