// contract_line hooks (spec AC-1).
// before_validate: description/unitPrice/taxCategory come from the product when the caller leaves them empty (same
//   rule as sales_invoice_line); `amount` is always quantity × unitPrice (the caller never controls it).
// before_create/update/delete: lines of a non-draft contract are frozen on every path — the kernel guards only the
//   replace-all saveLines path, direct repo writes are covered here (same as sales).
import {
  DOCSTATUS,
  isUuid,
  registry,
  repo,
  StateError,
  ValidationError,
  type Context,
  type HookArgs,
  type Infer,
} from '@daifuku/kernel';
import { Product } from '@daifuku/mod-product';
import { lineAmount, tryDecimal } from '@daifuku/mod-sales';
import { ContractLine } from '../entities/contract-line.ts';
import { Contract } from '../entities/contract.ts';

type Raw = Record<string, unknown>;
type ContractRow = Infer<typeof Contract>;

export const FROZEN_HINT =
  'Cancel and amend the contract to change its lines (ADR-0006); use contract.end to stop billing.';

function frozenError(parent: ContractRow): StateError {
  return new StateError(`contract ${parent.number ?? parent.id} is not a draft; its lines are frozen`, FROZEN_HINT, {
    contractId: parent.id,
    docstatus: parent.docstatus,
  });
}

async function assertParentDraft(ctx: Context, contractId: unknown): Promise<void> {
  if (typeof contractId !== 'string' || !isUuid(contractId)) return; // zod / FK report it
  const parent = await repo(ctx, Contract).find(contractId);
  if (parent && parent.docstatus !== DOCSTATUS.draft) throw frozenError(parent);
}

/** On create a missing value is undefined or null; on update only an explicit null asks for the product default. */
function wantsDefault(row: Raw, key: string, isCreate: boolean): boolean {
  return row[key] === null || (isCreate && row[key] === undefined);
}

async function applyProductDefaults(ctx: Context, row: Raw, previous: Raw | undefined): Promise<void> {
  const isCreate = previous === undefined;
  const productId = row.productId ?? previous?.productId;
  if (typeof productId !== 'string' || !isUuid(productId)) return;
  const keys = ['description', 'unitPrice', 'taxCategory'].filter((k) => wantsDefault(row, k, isCreate));
  if (keys.length === 0) return;
  const product = await repo(ctx, Product).find(productId);
  if (!product) return; // the FK reports it
  if (keys.includes('description')) row.description = product.name;
  if (keys.includes('taxCategory')) row.taxCategory = product.taxCategory;
  if (!keys.includes('unitPrice')) return;
  if (product.salePrice === null) {
    throw new ValidationError(
      `product ${product.code ?? product.name} has no sale price`,
      [{ path: 'unitPrice', message: 'required: the product has no salePrice' }],
      'Pass unitPrice on the line or set salePrice on the product.',
    );
  }
  row.unitPrice = product.salePrice;
}

function applyAmount(row: Raw, previous: Raw | undefined): void {
  const quantity = tryDecimal(row.quantity ?? previous?.quantity ?? '1');
  const unitPrice = tryDecimal(row.unitPrice ?? previous?.unitPrice);
  if (!quantity || !unitPrice) return; // zod reports the invalid/missing value
  row.amount = lineAmount(quantity, unitPrice);
}

async function beforeValidate(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  await applyProductDefaults(ctx, row, previous);
  applyAmount(row, previous);
}

export function registerLineHooks(): void {
  registry.registerHook(ContractLine.name, 'before_validate', beforeValidate);
  registry.registerHook(ContractLine.name, 'before_create', (ctx, { row }) => assertParentDraft(ctx, row.contractId));
  registry.registerHook(ContractLine.name, 'before_update', async (ctx, { row, previous }) => {
    await assertParentDraft(ctx, previous?.contractId);
    if (row.contractId !== previous?.contractId) await assertParentDraft(ctx, row.contractId);
  });
  registry.registerHook(ContractLine.name, 'before_delete', (ctx, { row }) => assertParentDraft(ctx, row.contractId));
}
