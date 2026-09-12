import { assertOp, Conflict, defineWriteCapability, PermissionDenied, registry, repo, StateError, withLock, withWriteCapability, type Context } from '@daifuku/kernel';
import { sha256Hex } from '@daifuku/mod-attachments';
import { WorkforceExpense } from '@daifuku/mod-workforce';
import { receiptInfo, WorkforceReceipt } from './receipt.ts';
import { validateReceipt, type ReceiptUpload } from './validation.ts';

const write = defineWriteCapability({ name: 'workforce_evidence.upload', entity: 'workforce_receipt', fields: Object.keys(WorkforceReceipt.config.fields), operations: ['create'] });
const actor = (ctx: Context) => ctx.actor.type === 'agent' ? ctx.actor.onBehalfOf : ctx.actor.type === 'user' ? ctx.actor.id : undefined;

async function editableExpense(ctx: Context, expenseId: string) {
  const expense = await repo(ctx, WorkforceExpense).get(expenseId);
  if (expense.userId !== actor(ctx)) throw new PermissionDenied('workforce_receipt', 'upload-for-another-employee', ctx.roles);
  if (!['draft', 'returned'].includes(expense.status)) throw new StateError('Receipts are frozen after submission.', 'Ask for the expense to be returned before adding evidence.');
  return expense;
}

export async function uploadReceipt(ctx: Context, expenseId: string, input: ReceiptUpload) {
  assertOp(ctx, WorkforceReceipt, 'create');
  const meta = validateReceipt(input);
  const first = await editableExpense(ctx, expenseId);
  return withLock(ctx, `workforce:employee:${first.employeeId}`, async () => {
    const expense = await editableExpense(ctx, expenseId);
    if (expense.version !== input.expectedVersion) throw new Conflict('The expense changed.', 'Reload it before adding the receipt.', { version: expense.version });
    const digest = await sha256Hex(input.data);
    if (await repo(ctx, WorkforceReceipt).count({ expenseId, sha256: digest })) throw new Conflict('This expense already has the same receipt.', 'Use the existing receipt.');
    if (await repo(ctx, WorkforceReceipt).count({ expenseId }) >= 10) throw new StateError('An expense may have at most ten receipts.', 'Keep additional evidence in your controlled document store and record the reference.');
    const stored = await ctx.storage.put(ctx.tenantId, input.data, { filename: meta.filename, contentType: meta.contentType });
    if (stored.sha256 !== digest || stored.size !== meta.size || !stored.key.startsWith(`${ctx.tenantId}/`)) throw new StateError('Stored receipt integrity check failed.', 'Verify the storage adapter.');
    const row = await withWriteCapability(ctx, write, (internal) => repo(internal, WorkforceReceipt).create({ expenseId, employeeId: expense.employeeId, userId: expense.userId, siteId: expense.siteId, filename: meta.filename, contentType: meta.contentType, size: meta.size, storageKey: stored.key, sha256: digest }));
    await repo(ctx, WorkforceExpense).touch(expenseId, input.expectedVersion);
    return { receipt: receiptInfo(row), expenseVersion: expense.version + 1 };
  });
}

export async function listReceipts(ctx: Context, expenseId: string) {
  await repo(ctx, WorkforceExpense).get(expenseId);
  const list = await repo(ctx, WorkforceReceipt).list({ where: { expenseId }, orderBy: [{ field: 'createdAt', dir: 'asc' }], limit: 10 });
  return { items: list.items.map(receiptInfo) };
}

export async function downloadReceipt(ctx: Context, receiptId: string) {
  const row = await repo(ctx, WorkforceReceipt).get(receiptId);
  await repo(ctx, WorkforceExpense).get(row.expenseId);
  if (!row.storageKey.startsWith(`${ctx.tenantId}/`)) throw new PermissionDenied('workforce_receipt', 'storage-scope', ctx.roles);
  const bytes = await ctx.storage.get(row.storageKey);
  if (bytes.byteLength !== row.size || await sha256Hex(bytes) !== row.sha256) throw new StateError('Receipt bytes do not match the recorded digest.', 'Restore the original evidence from a verified backup.');
  return { receipt: receiptInfo(row), bytes };
}

export function receiptHooks(): void {
  registry.registerHook('workforce_receipt', 'before_create', async (ctx, { row }) => {
    const parent = await editableExpense(ctx, String(row.expenseId));
    if (row.userId !== parent.userId || row.siteId !== parent.siteId || row.employeeId !== parent.employeeId) throw new PermissionDenied('workforce_receipt', 'receipt-identity', ctx.roles);
  });
  const frozen = () => { throw new StateError('Receipt evidence is immutable.', 'Return the expense and add corrected evidence with an explanation.'); };
  registry.registerHook('workforce_receipt', 'before_update', frozen);
  registry.registerHook('workforce_receipt', 'before_delete', frozen);
}
