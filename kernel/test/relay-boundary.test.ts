import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { defineEntity, f, label, makeContext, can, defineAction, checkActionPermission, type Db, type ContextParams } from '../src/index.ts';
import { compileDomain } from '../src/permissions.ts';
import { scopeCondition, assertRelayWrite } from '../src/repository/scope.ts';
import { z } from 'zod';
const bound = defineEntity({ name: 'relay_test_bound', label: label('Relay test', 'Relay test'), fields: { gatewayId: f.uuid({ required: true }) }, relayAccess: { operations: ['read', 'update'], field: 'gatewayId' }, permissions: { roles: { relay: ['read', 'update'], viewer: ['read'] } } });
const shared = defineEntity({ name: 'relay_test_shared', label: label('Shared test', 'Shared test'), fields: { name: f.text() }, siteAccess: { kind: 'sharedRead' }, permissions: { roles: { viewer: ['read'] } } });
const params: ContextParams = { tenantId: 'tenant', companyId: 'company', actor: { type: 'relay', id: 'gateway' }, roles: ['relay', 'admin'], relay: { gatewayId: 'gateway', siteId: 'site', credentialId: 'credential', credentialVersion: 1 } };
const ctx = makeContext({} as Db, params);
describe('machine principals have explicit independent authority boundaries', () => {
  it('cannot inherit admin, sharedRead or ordinary entity authority', () => {
    expect(can(ctx, shared, 'read')).toBe(false); expect(can(makeContext({} as Db, { ...params, accessScope: 'sites' }), shared, 'read')).toBe(false);
    expect(can(ctx, bound, 'read')).toBe(true); expect(can(ctx, bound, 'delete')).toBe(false);
    expect(can(makeContext({} as Db, { ...params, roles: ['admin'] }), bound, 'read')).toBe(false);
  });
  it('ANDs the gateway binding into repository scope even when role rules would be unrestricted', () => {
    const rendered = new PgDialect().sqlToQuery(scopeCondition(ctx, bound));
    expect(rendered.params).toEqual(['tenant', 'gateway', 'company']);
    expect(() => assertRelayWrite(ctx, bound, { gatewayId: 'other' })).toThrow('outside its gateway');
    expect(new PgDialect().sqlToQuery(scopeCondition(makeContext({} as Db, { tenantId: 'tenant', companyId: 'company', actor: ctx.actor, roles: ['relay'] }), bound)).sql).toContain('false');
  });
  it('provides actorId row tokens without granting authenticated actions', () => {
    const sql = compileDomain(ctx, bound, { gatewayId: '$ctx.actorId' }); expect(sql && new PgDialect().sqlToQuery(sql).params).toEqual(['gateway']);
    const action = defineAction({ name: 'relay_test.authenticated', description: label('Test', 'Test'), input: z.object({}), output: z.object({}), permission: 'authenticated', handler: async () => ({}) });
    expect(() => checkActionPermission(ctx, action)).toThrow('not permitted');
  });
});
