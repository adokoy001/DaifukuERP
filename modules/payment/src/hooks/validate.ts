// payment header hooks (spec AC-1, AC-2, AC-6).
// before_validate: the caller's roles must cover the (merged) direction — the rule the rowRules express for reads,
//   enforced here for create/update (and again at submit); a sent amount must be > 0. On create the computed fields are system-owned (reset
//   whatever was sent — this also cleans a copy made by amend), `date` defaults to today (JST) and `accountId` to the
//   `payment.accounts` cash/bank account for the method. On update an explicit `accountId: null` asks for that
//   default again (for the patched or stored method).
// before_update (drafts only): allocatedAmount / unallocatedAmount are re-derived from the stored lines, so a line
//   write (hooks/lines.ts touches the header), an amount change and a tampered patch all end in the same derived
//   state. No Σ <= amount check here: the generic update saves the header before its lines and the replace-all line
//   save creates before it deletes, so an intermediate Σ may legitimately exceed the amount; submit is the gate.
// after_lines_saved (phase15-cleanup AC-4): a replace-all line save touches the header once, whatever the line count.
import {
  Decimal,
  DOCSTATUS,
  PermissionDenied,
  registry,
  repo,
  todayLocal,
  ValidationError,
  type Context,
  type HookArgs,
} from '@daifuku/kernel';
import { PaymentAllocation } from '../entities/payment-allocation.ts';
import {
  Payment,
  PAYMENT_DIRECTIONS,
  PAYMENT_METHODS,
  type PaymentDirection,
  type PaymentMethod,
} from '../entities/payment.ts';
import {
  allocatedOf,
  roleAllowsDirection,
  rolesForDirection,
  tryDecimal,
  unallocatedOf,
} from '../services/allocate.ts';
import { defaultAccountIdFor, PAYMENT_ACCOUNTS_KEY } from '../settings.ts';

type Raw = Record<string, unknown>;

/** Fields the caller never controls on a draft. */
export const SYSTEM_OWNED_FIELDS = ['allocatedAmount', 'unallocatedAmount', 'journalEntryId'] as const;

export const DIRECTION_HINT =
  'Use a context whose roles cover this direction (accounting: both; sales: receive; purchasing: pay).';

function isDirection(v: unknown): v is PaymentDirection {
  return typeof v === 'string' && (PAYMENT_DIRECTIONS as readonly string[]).includes(v);
}
function isMethod(v: unknown): v is PaymentMethod {
  return typeof v === 'string' && (PAYMENT_METHODS as readonly string[]).includes(v);
}

/** AC-6: PERMISSION_DENIED (op `<op>:<direction>`) when the context's roles do not cover the direction. */
export function assertDirectionRole(ctx: Context, direction: unknown, op: string): void {
  if (!isDirection(direction)) return; // zod reports the invalid enum
  if (roleAllowsDirection(ctx.roles, direction)) return;
  ctx.log.info('payment direction refused', {
    op,
    direction,
    roles: ctx.roles,
    requiredRoles: rolesForDirection(direction),
    hint: DIRECTION_HINT,
  });
  throw new PermissionDenied(Payment.name, `${op}:${direction}`, ctx.roles);
}

async function fillAccount(ctx: Context, row: Raw, method: unknown): Promise<void> {
  if (!isMethod(method)) return; // zod reports the invalid enum
  const found = await defaultAccountIdFor(ctx, method);
  if (!found.id) {
    throw new ValidationError(
      `payment.accountId is required: no account has code ${found.code} (${PAYMENT_ACCOUNTS_KEY} default for method ${method})`,
      [{ path: 'accountId', message: `required: default account code ${found.code} does not exist` }],
      `Pass accountId, create the account with code ${found.code}, or change ${PAYMENT_ACCOUNTS_KEY}.`,
    );
  }
  row.accountId = found.id;
}

function assertPositiveAmount(row: Raw, previous: Raw | undefined): void {
  if (row.amount === undefined && previous) return;
  const amount = tryDecimal(row.amount);
  if (amount && !amount.gt(0))
    throw new ValidationError(
      `payment amount ${amount.toString()} must be greater than 0`,
      [{ path: 'amount', message: 'must be > 0' }],
      'A payment moves a positive amount; the direction says which way.',
    );
}

async function beforeValidate(ctx: Context, { row, previous }: HookArgs): Promise<void> {
  const direction = row.direction !== undefined ? row.direction : previous?.direction;
  assertDirectionRole(ctx, direction, previous ? 'update' : 'create');
  assertPositiveAmount(row, previous);
  if (!previous) {
    // a new draft has no lines yet: everything is unallocated
    Object.assign(row, {
      allocatedAmount: '0',
      unallocatedAmount: tryDecimal(row.amount)?.toString() ?? '0',
      journalEntryId: null,
    });
    if (row.date === undefined || row.date === null) row.date = todayLocal(ctx.now());
    if (row.method === undefined || row.method === null) row.method = 'bank_transfer';
    if (row.accountId === undefined || row.accountId === null) await fillAccount(ctx, row, row.method);
    return;
  }
  if (row.accountId === null) await fillAccount(ctx, row, row.method ?? previous.method);
}

async function beforeUpdate(ctx: Context, { row }: HookArgs): Promise<void> {
  if (row.docstatus !== DOCSTATUS.draft) return;
  const lines = await repo(ctx, PaymentAllocation).list({ where: { paymentId: row.id as string }, limit: 500 });
  const allocated = allocatedOf(lines.items);
  const amount = row.amount instanceof Decimal ? row.amount : Decimal.from(String(row.amount ?? '0'));
  Object.assign(row, {
    allocatedAmount: allocated,
    unallocatedAmount: unallocatedOf(amount, allocated),
    journalEntryId: null,
  });
}

/** One header touch per saveLines call; before_update above re-derives the amounts. `row` is the parent, re-read by the kernel. */
async function afterLinesSaved(ctx: Context, { row }: HookArgs): Promise<void> {
  if (row.docstatus !== DOCSTATUS.draft) return;
  await repo(ctx, Payment).update(row.id as string, {});
}

export function registerValidateHooks(): void {
  registry.registerHook(Payment.name, 'before_validate', beforeValidate);
  registry.registerHook(Payment.name, 'before_update', beforeUpdate);
  registry.registerHook(Payment.name, 'after_lines_saved', afterLinesSaved);
}
