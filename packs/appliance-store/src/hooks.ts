import {
  cancelDocument,
  Decimal,
  DOCSTATUS,
  getLines,
  isLocalDate,
  registry,
  repo,
  StateError,
  ValidationError,
  type Context,
  type HookArgs,
  type LocalDate,
} from '@daifuku/kernel';
import { Contract } from '@daifuku/mod-contract';
import { Partner } from '@daifuku/mod-partner';
import { Product } from '@daifuku/mod-product';
import { SalesInvoice, tryDecimal } from '@daifuku/mod-sales';
import { ApplianceDevice } from './entities/device.ts';
import { ApplianceService } from './entities/service.ts';
import { ApplianceServiceLine } from './entities/service-line.ts';

function invalid(path: string, message: string): never {
  throw new ValidationError(message, [{ path, message }]);
}
function validDate(value: unknown): value is LocalDate {
  return typeof value === 'string' && isLocalDate(value);
}

async function validateDevice(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  const value = { ...previous, ...row };
  if (typeof value.partnerId !== 'string') return;
  const customer = await repo(ctx, Partner).get(value.partnerId);
  if (!customer.isCustomer) invalid('partnerId', 'Select a customer for this appliance.');
  if (typeof value.contractId === 'string') {
    const contract = await repo(ctx, Contract).get(value.contractId);
    if (contract.partnerId !== value.partnerId)
      invalid('contractId', 'The maintenance contract must belong to the same customer.');
  }
  if (validDate(value.purchaseDate) && validDate(value.warrantyUntil) && value.warrantyUntil < value.purchaseDate)
    invalid('warrantyUntil', 'Warranty expiry cannot precede purchase.');
}

async function validateService(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  const value = { ...previous, ...row };
  if (typeof value.deviceId === 'string') {
    const device = await repo(ctx, ApplianceDevice).get(value.deviceId);
    if (device.partnerId !== value.partnerId) invalid('deviceId', 'The appliance must belong to this customer.');
  }
  if (validDate(value.date)) {
    for (const key of ['scheduledDate', 'completedDate']) {
      const date = value[key];
      if (validDate(date) && date < value.date) invalid(key, 'The date cannot precede reception.');
    }
  }
}

async function validateLine(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  const value = { ...previous, ...row };
  if (typeof value.productId === 'string') {
    const product = await repo(ctx, Product).get(value.productId);
    if (!product.isSold || !product.isActive) invalid('productId', 'Select an active saleable service or part.');
  }
  // Repository applies DSL defaults after before_validate; include the create default in derived amounts.
  const quantity = tryDecimal(!previous && row.quantity === undefined ? '1' : value.quantity);
  const unitPrice = tryDecimal(value.unitPrice);
  if (quantity && unitPrice) row.amount = quantity.times(unitPrice);
}

async function beforeSubmit(ctx: Context, args: HookArgs): Promise<void> {
  await validateService(ctx, args);
  const { row } = args;
  if (row.status !== 'in_progress')
    throw new StateError('Start work before completing this job.', 'Use appliance_store.start_service.');
  if (!validDate(row.completedDate)) invalid('completedDate', 'Record the completion date.');
  if (typeof row.workReport !== 'string' || !row.workReport.trim()) invalid('workReport', 'Record the completed work.');
  const lines = (await getLines(ctx, ApplianceService, String(row.id)))[ApplianceServiceLine.name] ?? [];
  if (
    row.billing === 'billable' &&
    (lines.length === 0 || !Decimal.sum(lines.map((line) => Decimal.from(line.amount as string | Decimal))).gt(0))
  )
    invalid('lines', 'A billable job requires a positive service or parts total.');
  if (row.billing === 'no_charge' && lines.length)
    invalid(
      'lines',
      'No-charge jobs cannot contain billing lines; record warranty parts consumption with an inventory entry.',
    );
  row.status = 'completed';
}

async function afterCancel(ctx: Context, { row, correctionDate }: HookArgs): Promise<void> {
  if (typeof row.salesInvoiceId !== 'string') return;
  const invoice = await repo(ctx, SalesInvoice).get(row.salesInvoiceId);
  if (invoice.docstatus === DOCSTATUS.submitted)
    await cancelDocument(ctx, SalesInvoice, invoice.id, { correctionDate });
}

export function registerApplianceHooks(): void {
  registry.registerHook(ApplianceDevice.name, 'before_validate', validateDevice);
  registry.registerHook(ApplianceService.name, 'before_validate', validateService);
  registry.registerHook(ApplianceServiceLine.name, 'before_validate', validateLine);
  registry.registerHook(ApplianceService.name, 'before_submit', beforeSubmit);
  registry.registerHook(ApplianceService.name, 'before_cancel', (_ctx, { row }) => {
    row.status = 'cancelled';
  });
  registry.registerHook(ApplianceService.name, 'after_cancel', afterCancel);
  registry.registerHook(ApplianceService.name, 'before_delete', (_ctx, { row }) => {
    if (row.status !== 'queued')
      throw new StateError(
        'A started job cannot be deleted.',
        'Complete it, then cancel and amend if a correction is needed.',
      );
  });
}
