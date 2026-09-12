// unit.status is computed (spec AC-1): 'vacant' on create; on every update it is re-derived from the unit's submitted
// leases as of today (services/rent-roll.ts unitStatusOn), whatever the patch said. Contract submit / update (contract.end,
// generation touches) / cancel refresh the units they are bound to, and so do move_in / move_out. A refresh writes only
// when the derived status differs from the stored one, so billing runs do not churn unit versions or audit rows.
// A unit referenced by a live contract (draft or submitted) cannot be deleted: ext.unitId is JSONB and has no FK.
import { DOCSTATUS, registry, repo, StateError, todayLocal, type Context, type HookArgs } from '@daifuku/kernel';
import { Contract } from '@daifuku/mod-contract';
import { RealEstateUnit } from '../entities/unit.ts';
import { leasesOfUnits, unitIdOf } from '../load.ts';
import { unitStatusOn, type UnitStatus } from '../services/rent-roll.ts';

export const UNIT_IN_USE_HINT = 'Cancel or delete the contracts bound to this unit (ext.unitId) first.';

export async function derivedUnitStatus(ctx: Context, unitId: string): Promise<UnitStatus> {
  return unitStatusOn(await leasesOfUnits(ctx, [unitId]), todayLocal(ctx.now()));
}

/** Re-derives a unit's status and touches the unit only when it changed. Returns the status (null: no such unit). */
export async function refreshUnitStatus(ctx: Context, unitId: string): Promise<UnitStatus | null> {
  const r = repo(ctx, RealEstateUnit);
  const unit = await r.find(unitId);
  if (!unit) return null;
  const status = await derivedUnitStatus(ctx, unitId);
  if (status !== unit.status) await r.update(unitId, {});
  return status;
}

async function beforeValidate(_ctx: Context, { row, previous }: HookArgs): Promise<void> {
  if (!previous) row.status = 'vacant';
}

async function beforeUpdate(ctx: Context, { row }: HookArgs): Promise<void> {
  if (typeof row.id === 'string') row.status = await derivedUnitStatus(ctx, row.id);
}

async function beforeDelete(ctx: Context, { row }: HookArgs): Promise<void> {
  const id = row.id as string;
  const bound = await repo(ctx, Contract).count({ 'ext.unitId': id, docstatus: { $ne: DOCSTATUS.cancelled } });
  if (bound > 0) throw new StateError(`real_estate_unit ${String(row.code ?? id)} is bound to ${bound} contract(s)`, UNIT_IN_USE_HINT, { unitId: id, contracts: bound });
}

/** after_submit / after_update / after_cancel of a contract: refresh the unit(s) it is (or was) bound to. */
async function refreshContractUnits(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  const ids = new Set([unitIdOf(row), previous ? unitIdOf(previous) : null].filter((v): v is string => v !== null));
  for (const id of ids) await refreshUnitStatus(ctx, id);
}

export function registerUnitStatusHooks(): void {
  registry.registerHook(RealEstateUnit.name, 'before_validate', beforeValidate);
  registry.registerHook(RealEstateUnit.name, 'before_update', beforeUpdate);
  registry.registerHook(RealEstateUnit.name, 'before_delete', beforeDelete);
  for (const phase of ['after_submit', 'after_update', 'after_cancel'] as const) registry.registerHook(Contract.name, phase, refreshContractUnits);
}
