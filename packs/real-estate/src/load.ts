// Reads shared by the pack's hooks and actions, all through the repository port in the caller's context (no bypass).
// A lease is a submitted contract whose ext.unitId names a real_estate_unit (the link lives in the contract's JSONB ext,
// so it is filtered with the kernel's `ext.<key>` where, ADR-0014).
import { Decimal, DOCSTATUS, isDecimal, repo, StateError, type Context, type ListResult } from '@daifuku/kernel';
import { Account } from '@daifuku/mod-accounting';
import { Contract, type ContractRow } from '@daifuku/mod-contract';
import { Partner } from '@daifuku/mod-partner';
import { RealEstateProperty } from './entities/property.ts';
import { RealEstateUnit } from './entities/unit.ts';

const PAGE = 500;
const CHUNK = 200;

/** Every page of a list query (repo.list caps a page at 500). */
export async function allPages<T>(page: (offset: number) => Promise<ListResult<T>>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; ) {
    const res = await page(offset);
    out.push(...res.items);
    offset += res.items.length;
    if (res.items.length === 0 || offset >= res.total) return out;
  }
}

/** Runs `fn` over the distinct ids in chunks (keeps `$in` lists short). */
export async function inChunks<T>(ids: readonly string[], fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const unique = [...new Set(ids)];
  const out: T[] = [];
  for (let i = 0; i < unique.length; i += CHUNK) out.push(...(await fn(unique.slice(i, i + CHUNK))));
  return out;
}

/** ext.unitId of a contract (raw row or domain row), or null. */
export function unitIdOf(row: { ext?: unknown }): string | null {
  const ext = row.ext;
  if (typeof ext !== 'object' || ext === null) return null;
  const v = (ext as Record<string, unknown>).unitId;
  return typeof v === 'string' ? v : null;
}

/** A decimal ext value (stored as a normalised decimal string); 0 when absent. */
export function extDecimal(row: { ext?: unknown }, key: string): Decimal {
  const ext = row.ext;
  const v = typeof ext === 'object' && ext !== null ? (ext as Record<string, unknown>)[key] : undefined;
  if (isDecimal(v)) return v;
  return typeof v === 'string' && Decimal.isDecimalString(v) ? Decimal.from(v) : Decimal.zero();
}

/** Submitted contracts bound to any of the units. */
export async function leasesOfUnits(ctx: Context, unitIds: readonly string[]): Promise<ContractRow[]> {
  const r = repo(ctx, Contract);
  return inChunks(unitIds, (chunk) => allPages((offset) => r.list({ where: { docstatus: DOCSTATUS.submitted, 'ext.unitId': { $in: chunk } }, orderBy: [{ field: 'startDate', dir: 'asc' }], limit: PAGE, offset })));
}

export async function byIds<T extends { id: string }>(ids: readonly string[], list: (chunk: string[]) => Promise<ListResult<T>>): Promise<Map<string, T>> {
  const rows = await inChunks(ids, async (chunk) => (await list(chunk)).items);
  return new Map(rows.map((row) => [row.id, row]));
}

export async function partnerNames(ctx: Context, ids: readonly string[]): Promise<Map<string, string>> {
  const r = repo(ctx, Partner);
  const rows = await byIds(ids, (chunk) => r.list({ where: { id: { $in: chunk } }, limit: chunk.length }));
  return new Map([...rows.values()].map((p) => [p.id, p.name]));
}

export function unitsById(ctx: Context, ids: readonly string[]) {
  const r = repo(ctx, RealEstateUnit);
  return byIds(ids, (chunk) => r.list({ where: { id: { $in: chunk } }, limit: chunk.length }));
}

export function propertiesById(ctx: Context, ids: readonly string[]) {
  const r = repo(ctx, RealEstateProperty);
  return byIds(ids, (chunk) => r.list({ where: { id: { $in: chunk } }, limit: chunk.length }));
}

export const ACCOUNT_HINT = 'seed the chart of accounts (l10n/jp) and apply the real_estate pack, or change real_estate.accounts';

/** Account id for a code; INVALID_STATE naming the setting when it does not exist. */
export async function accountIdByCode(ctx: Context, code: string, role: string): Promise<string> {
  const found = await repo(ctx, Account).list({ where: { code }, limit: 1 });
  const account = found.items[0];
  if (!account) throw new StateError(`account code ${code} (${role}) does not exist`, ACCOUNT_HINT, { code, role });
  return account.id;
}
