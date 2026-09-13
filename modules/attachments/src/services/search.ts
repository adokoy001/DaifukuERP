// Pure builder for the 電帳法 search (docs/specs/attachments.md AC-4): date range, amount range, partner, kind — AND of
// the given criteria. Ranges become `$and` pairs because a domain field takes one operator at a time.
import { Decimal, ValidationError, type Domain } from '@daifuku/kernel';
import type { AttachmentKind } from '../entities/attachment.ts';

export interface SearchCriteria {
  txnDateFrom?: string | undefined;
  txnDateTo?: string | undefined;
  amountFrom?: string | undefined;
  amountTo?: string | undefined;
  partnerId?: string | undefined;
  kind?: AttachmentKind | undefined;
}

function range(field: string, from: string | undefined, to: string | undefined): Domain[] {
  const out: Domain[] = [];
  if (from !== undefined) out.push({ [field]: { $gte: from } });
  if (to !== undefined) out.push({ [field]: { $lte: to } });
  return out;
}

/** Decimal strings are canonicalised so `"1,000"`-style input fails early and `"1000.0"` compares as 1000. */
function canonicalAmount(path: string, s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  try {
    return Decimal.from(s).toString();
  } catch {
    throw new ValidationError(`${path} is not a decimal`, [
      { path, message: 'expected a decimal string like "1234.50"' },
    ]);
  }
}

export function buildSearchDomain(q: SearchCriteria): Domain | undefined {
  if (q.txnDateFrom !== undefined && q.txnDateTo !== undefined && q.txnDateFrom > q.txnDateTo) {
    throw new ValidationError('txnDateFrom is after txnDateTo', [
      { path: 'txnDateFrom', message: 'must be <= txnDateTo' },
    ]);
  }
  const amountFrom = canonicalAmount('amountFrom', q.amountFrom);
  const amountTo = canonicalAmount('amountTo', q.amountTo);
  if (amountFrom !== undefined && amountTo !== undefined && Decimal.from(amountFrom).gt(amountTo)) {
    throw new ValidationError('amountFrom is greater than amountTo', [
      { path: 'amountFrom', message: 'must be <= amountTo' },
    ]);
  }
  const and: Domain[] = [...range('txnDate', q.txnDateFrom, q.txnDateTo), ...range('amount', amountFrom, amountTo)];
  const domain: Domain = {};
  if (q.partnerId !== undefined) domain.partnerId = q.partnerId;
  if (q.kind !== undefined) domain.kind = q.kind;
  if (and.length > 0) domain.$and = and;
  return Object.keys(domain).length === 0 ? undefined : domain;
}
