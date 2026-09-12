// stock_entry header hooks (docs/specs/inventory.md AC-2, AC-9).
// before_validate: the caller's roles must cover the (merged) type — purchasing: receipts; sales: only through this
//   module's own hooks (roleAllowsEntry). On create `sourceEntity`/`sourceId` are system-owned (reset unless this module
//   is writing — this also unlinks a copy made by amend), `date` defaults to today (JST) and `warehouseId` to the default
//   warehouse; on update a patch cannot touch the source link. A destination warehouse is accepted only on transfers.
//   Completeness (lines, toWarehouseId of a transfer) is checked at submit (hooks/submit.ts).
import { isUuid, PermissionDenied, registry, todayLocal, ValidationError, type Context, type HookArgs } from '@daifuku/kernel';
import { STOCK_ENTRY_TYPES, StockEntry, type StockEntryType } from '../entities/stock-entry.ts';
import { ROLE_HINT, roleAllowsEntry } from '../services/entry-rules.ts';
import { resolveDefaultWarehouse } from '../settings.ts';
import { isModuleWrite } from '../system-write.ts';

type Raw = Record<string, unknown>;

export function isEntryType(v: unknown): v is StockEntryType {
  return typeof v === 'string' && (STOCK_ENTRY_TYPES as readonly string[]).includes(v);
}

/** AC-9: PERMISSION_DENIED (op `<op>:<type>`) when the caller's roles do not cover this entry type. */
export function assertEntryRole(ctx: Context, type: unknown, op: string): void {
  if (!isEntryType(type)) return; // zod reports the invalid enum
  if (roleAllowsEntry(ctx.roles, type, isModuleWrite(ctx))) return;
  ctx.log.info('stock entry type refused for roles', { op, type, roles: ctx.roles, hint: ROLE_HINT });
  throw new PermissionDenied(StockEntry.name, `${op}:${type}`, ctx.roles);
}

function merged(row: Raw, previous: Raw | undefined, key: string): unknown {
  return row[key] !== undefined ? row[key] : previous?.[key];
}

function assertDestination(row: Raw, previous: Raw | undefined): void {
  const type = merged(row, previous, 'type');
  const from = merged(row, previous, 'warehouseId');
  const to = merged(row, previous, 'toWarehouseId');
  if (to === null || to === undefined || !isEntryType(type)) return;
  if (type !== 'transfer') {
    throw new ValidationError(`stock_entry of type ${type} cannot have toWarehouseId`, [{ path: 'toWarehouseId', message: 'only a transfer has a destination warehouse' }], 'Clear toWarehouseId (send null), or use type transfer.');
  }
  if (to === from) throw new ValidationError('stock_entry transfer: toWarehouseId must differ from warehouseId', [{ path: 'toWarehouseId', message: 'must differ from warehouseId' }], 'Pick another destination warehouse.');
}

async function beforeValidate(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  assertEntryRole(ctx, merged(row, previous, 'type'), previous ? 'update' : 'create');
  const moduleWrite = isModuleWrite(ctx);
  if (!previous) {
    if (!moduleWrite) Object.assign(row, { sourceEntity: null, sourceId: null });
    if (row.date === undefined || row.date === null) row.date = todayLocal(ctx.now());
    if (row.warehouseId === undefined || row.warehouseId === null) row.warehouseId = (await resolveDefaultWarehouse(ctx)).id;
  } else if (!moduleWrite) {
    delete row.sourceEntity;
    delete row.sourceId;
  }
  if (typeof row.warehouseId === 'string' && !isUuid(row.warehouseId)) return; // zod reports it
  assertDestination(row, previous);
}

export function registerEntryHooks(): void {
  registry.registerHook(StockEntry.name, 'before_validate', beforeValidate);
}
