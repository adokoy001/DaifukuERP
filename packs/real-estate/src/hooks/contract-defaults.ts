// Lease defaults (spec AC-2, AC-3).
// contract before_validate: when the contract carries ext.unitId (a lease) the unit must exist, and the money ext keys
//   default to 0 (ext fields cannot declare a default, ADR-0014): keyMoney, depositMonths, renewalFee. Contracts without a
//   unit (maintenance contracts of other companies — the pack's hooks run for every company) are left alone.
// contract_line before_validate: a line whose taxCategory is still empty gets the unit usage's category
//   (services/tax-rule.ts: residential → non_taxable, office/store/parking → standard, short-term residential → standard).
//   The header hook cannot do this: the kernel saves lines after the header, and lines are separate entities. Because the
//   contract module's own line hook runs first (registration order), the precedence is: the caller's taxCategory, then the
//   product's (RENT = non_taxable, RENT_TAXABLE = standard), then the unit usage.
import { isUuid, registry, repo, ValidationError, type Context, type HookArgs } from '@daifuku/kernel';
import { Contract, ContractLine } from '@daifuku/mod-contract';
import { RealEstateUnit } from '../entities/unit.ts';
import { unitIdOf } from '../load.ts';
import { rentTaxCategory } from '../services/tax-rule.ts';

export const LEASE_MONEY_KEYS = ['keyMoney', 'depositMonths', 'renewalFee'] as const;

async function beforeValidateContract(ctx: Context, { row }: HookArgs): Promise<void> {
  const ext = row.ext;
  if (typeof ext !== 'object' || ext === null) return;
  const unitId = unitIdOf(row);
  if (unitId === null || !isUuid(unitId)) return; // not a lease, or zod reports the malformed uuid
  const unit = await repo(ctx, RealEstateUnit).find(unitId);
  if (!unit) {
    throw new ValidationError(
      `real_estate_unit ${unitId} does not exist`,
      [{ path: 'ext.unitId', message: 'unit not found' }],
      'Pick a unit from real_estate_unit.list (物件 → 部屋・区画).',
    );
  }
  const filled: Record<string, unknown> = { ...(ext as Record<string, unknown>) };
  for (const key of LEASE_MONEY_KEYS) if (filled[key] === undefined || filled[key] === null) filled[key] = '0';
  row.ext = filled;
}

async function beforeValidateLine(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  const wantsDefault = row.taxCategory === null || (previous === undefined && row.taxCategory === undefined);
  if (!wantsDefault) return;
  const contractId = row.contractId ?? previous?.contractId;
  if (typeof contractId !== 'string' || !isUuid(contractId)) return;
  const contract = await repo(ctx, Contract).find(contractId);
  const unitId = contract ? unitIdOf(contract) : null;
  if (!contract || unitId === null) return;
  const unit = await repo(ctx, RealEstateUnit).find(unitId);
  if (unit) row.taxCategory = rentTaxCategory(unit.usage, { startDate: contract.startDate, endDate: contract.endDate });
}

export function registerContractDefaultHooks(): void {
  registry.registerHook(Contract.name, 'before_validate', beforeValidateContract);
  registry.registerHook(ContractLine.name, 'before_validate', beforeValidateLine);
}
