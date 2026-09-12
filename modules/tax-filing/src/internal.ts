import { defineWriteCapability, hasWriteCapability, registry, withWriteCapability, StateError, withLock, type Context, type EntityDef } from '@daifuku/kernel';
import { Account, JournalEntry } from '@daifuku/mod-accounting';
import { WorkforceEmployee } from '@daifuku/mod-workforce';
import { FilingAccountingProfile, FilingPayrollProfile, FilingAccountingPack, FilingPayrollPack } from './entities.ts';
const entities = [FilingAccountingProfile, FilingPayrollProfile, FilingAccountingPack, FilingPayrollPack];
const capabilities = new Map(entities.map((e) => [e.name, defineWriteCapability({ name: e.name + '.workflow', entity: e.name, fields: e.fieldNames, operations: ['create', 'update', 'workflow'] })]));
export function filingWrite<T>(ctx: Context, entity: EntityDef, work: (write: Context) => Promise<T>): Promise<T> { const cap = capabilities.get(entity.name); if (!cap) throw new Error('Unknown filing entity'); return withWriteCapability(ctx, cap, work); }
export function registerFilingGuards() {
 for (const e of [Account, JournalEntry]) for (const phase of ['before_create', 'before_update', 'before_delete'] as const) registry.registerHook(e.name, phase, (ctx) => withLock(ctx, 'accounting-periods', async () => undefined));
 registry.registerHook(WorkforceEmployee.name, 'before_create', (ctx) => withLock(ctx, 'workforce:policies', async () => undefined));
 registry.registerHook(WorkforceEmployee.name, 'before_delete', (ctx, { row }) => withLock(ctx, 'workforce:employee:' + String(row.id), async () => undefined));
 for (const e of entities) for (const phase of ['before_create', 'before_update', 'before_delete'] as const) registry.registerHook(e.name, phase, (ctx) => { if (phase === 'before_delete' || !hasWriteCapability(ctx, e.name, 'workflow')) throw new StateError('申告準備の専用操作を使ってください', '根拠・確認履歴は汎用CRUDで変更・削除できません。'); }); }
