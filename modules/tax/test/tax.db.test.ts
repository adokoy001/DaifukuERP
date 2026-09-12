import { Conflict, Decimal, PermissionDenied, ValidationError, auditTrail, newId, registerCrudActions, registry, repo, runAction, systemParams, withContext } from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_TAX_RATES, TAX_PRICE_INCLUDES_TAX_KEY, TAX_SETTINGS_DEFAULT, TaxModule, TaxRate, taxSummaryFor } from '../src/index.ts';

let db: TestDb;

const asRole = (roles: string[]) => ({ roles, actor: { type: 'user' as const, id: newId() } });
const seed = () => withContext(db.app, systemParams(db.tenantId, db.companyId), async (ctx) => TaxModule.seed?.(ctx));
const caught = async (p: Promise<unknown>): Promise<unknown> => p.then(() => null).catch((e: unknown) => e);

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
});
afterAll(async () => {
  await db.close();
});

describe('tax module (docs/specs/tax.md)', () => {
  it('AC-8 seed creates the 6 Japanese rate rows and is idempotent', async () => {
    const codes = SEED_TAX_RATES.map((r) => r.code);
    const count = () => db.run({}, (ctx) => repo(ctx, TaxRate).count({ code: { $in: codes } }));
    expect(await count()).toBe(0);
    await seed();
    expect(await count()).toBe(6);
    await seed();
    expect(await count()).toBe(6);
    const std10 = await db.run({}, async (ctx) => (await repo(ctx, TaxRate).list({ where: { code: 'STD10' } })).items[0]);
    expect(std10).toMatchObject({ category: 'standard', validFrom: '2019-10-01', validTo: null, label: '標準10%', version: 1 });
    expect(std10?.rate).toBeInstanceOf(Decimal);
    expect(std10?.rate.toString()).toBe('0.1');
    const std8 = await db.run({}, async (ctx) => (await repo(ctx, TaxRate).list({ where: { code: 'STD8' } })).items[0]);
    expect(std8).toMatchObject({ category: 'standard', validFrom: '2014-04-01', validTo: '2019-09-30' });
  });

  it('AC-1 entity: code is upper-cased, unique and immutable; rate >= 0; zero-rate categories must be 0', async () => {
    const std5 = await db.run({}, (ctx) => repo(ctx, TaxRate).create({ code: 'std5', category: 'standard', rate: '0.05', validFrom: '1997-04-01', validTo: '2014-03-31', label: '標準5%' }));
    expect(std5.code).toBe('STD5');
    expect(std5.rate.toString()).toBe('0.05');
    await expect(db.run({}, (ctx) => repo(ctx, TaxRate).create({ code: 'STD5', category: 'standard', rate: '0.05', validFrom: '1989-04-01', validTo: '1997-03-31', label: 'dup' }))).rejects.toBeInstanceOf(Conflict);
    await expect(db.run({}, (ctx) => repo(ctx, TaxRate).update(std5.id, { code: 'STD5X' }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'code' }] } });
    await expect(db.run({}, (ctx) => repo(ctx, TaxRate).create({ code: 'NEG', category: 'standard', rate: '-0.1', validFrom: '1900-01-01', validTo: '1900-12-31', label: 'neg' }))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { issues: [{ path: 'rate' }] },
    });
    await expect(db.run({}, (ctx) => repo(ctx, TaxRate).create({ code: 'BADX', category: 'exempt', rate: '0.1', validFrom: '1900-01-01', validTo: '1900-12-31', label: 'x' }))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { issues: [{ path: 'rate', message: 'must be 0 for exempt' }] },
    });
    await expect(db.run({}, (ctx) => repo(ctx, TaxRate).create({ code: 'BADCAT', category: 'vat' as 'standard', rate: '0.1', validFrom: '1900-01-01', label: 'x' }))).rejects.toMatchObject({ details: { issues: [{ path: 'category' }] } });
    await expect(db.run({}, (ctx) => repo(ctx, TaxRate).create({ code: 'bad code', category: 'standard', rate: '0.1', validFrom: '1900-01-01', validTo: '1900-12-31', label: 'x' }))).rejects.toMatchObject({ details: { issues: [{ path: 'code' }] } });
  });

  it('AC-1 overlap: create/update whose period overlaps another row of the same category is rejected, naming the conflicting code', async () => {
    const attempt = (input: Record<string, unknown>) => caught(db.run({}, (ctx) => runAction(ctx, 'tax_rate.create', input)));
    const err = (await attempt({ code: 'STD12', category: 'standard', rate: '0.12', validFrom: '2030-04-01', label: '標準12%' })) as ValidationError;
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('STD10');
    expect(err.details).toMatchObject({ issues: [{ path: 'validFrom', message: 'overlaps tax_rate STD10' }] });
    expect(err.hint).toContain('STD10');
    // touching only the last day of STD8 (2019-09-30) is still an overlap; the day after STD5 ends is fine
    expect((await attempt({ code: 'X1', category: 'standard', rate: '0.1', validFrom: '2019-09-30', validTo: '2019-09-30', label: 'x' })) as ValidationError).toMatchObject({ message: expect.stringContaining('STD8') });
    expect(await attempt({ code: 'X2', category: 'reduced', rate: '0.05', validFrom: '2000-01-01', validTo: '2019-09-30', label: 'x' })).toBeNull();
    // validTo before validFrom
    expect(await attempt({ code: 'X3', category: 'reduced', rate: '0.05', validFrom: '1990-01-01', validTo: '1989-12-31', label: 'x' })).toMatchObject({ details: { issues: [{ path: 'validTo' }] } });
    // update: extending X2 into RED8's period is rejected; the row keeps its values
    const x2 = await db.run({}, async (ctx) => (await repo(ctx, TaxRate).list({ where: { code: 'X2' } })).items[0]);
    expect(x2).toBeDefined();
    const x2id = x2?.id ?? '';
    await expect(db.run({}, (ctx) => repo(ctx, TaxRate).update(x2id, { validTo: '2019-10-01' }))).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('RED8') });
    await expect(db.run({}, (ctx) => repo(ctx, TaxRate).update(x2id, { validTo: null }))).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('RED8') });
    const shortened = await db.run({}, (ctx) => repo(ctx, TaxRate).update(x2id, { validTo: '2010-12-31' }));
    expect(shortened.validTo).toBe('2010-12-31');
    // a second company is independent (overlap is per company)
    const otherCompany = newId();
    await db.owner.sql`insert into companies (id, tenant_id, code, name) values (${otherCompany}, ${db.tenantId}, 'T2', 'Second Co')`;
    const other = await withContext(db.app, systemParams(db.tenantId, otherCompany), (ctx) => repo(ctx, TaxRate).create({ code: 'STD10', category: 'standard', rate: '0.1', validFrom: '2019-10-01', label: 'x' }));
    expect(other.companyId).toBe(otherCompany);
  });

  it('AC-1 permissions: accounting/settings create+update, sales/purchasing/viewer read only, others denied', async () => {
    const created = await db.run(asRole(['accounting']), (ctx) => repo(ctx, TaxRate).create({ code: 'ACC1', category: 'reduced', rate: '0.03', validFrom: '1980-01-01', validTo: '1980-12-31', label: 'acc' }));
    const updated = await db.run(asRole(['settings']), (ctx) => repo(ctx, TaxRate).update(created.id, { label: 'acc2' }));
    expect(updated.version).toBe(2);
    for (const role of ['sales', 'purchasing', 'viewer']) {
      const got = await db.run(asRole([role]), (ctx) => repo(ctx, TaxRate).get(created.id));
      expect(got.label).toBe('acc2');
      await expect(db.run(asRole([role]), (ctx) => repo(ctx, TaxRate).update(created.id, { label: 'no' }))).rejects.toBeInstanceOf(PermissionDenied);
    }
    await expect(db.run(asRole(['accounting']), (ctx) => repo(ctx, TaxRate).delete(created.id))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(db.run(asRole(['nobody']), (ctx) => repo(ctx, TaxRate).list())).rejects.toBeInstanceOf(PermissionDenied);
    await db.run({}, (ctx) => repo(ctx, TaxRate).delete(created.id));
  });

  it('AC-5 settings: defaults when unset, set by admin/settings role only, validated, audited, declared in the registry', async () => {
    expect(registry.hasSetting('tax.rounding')).toBe(true);
    expect(registry.hasSetting(TAX_PRICE_INCLUDES_TAX_KEY)).toBe(true);
    expect(await db.run(asRole(['viewer']), (ctx) => runAction(ctx, 'tax.get_settings', {}))).toEqual(TAX_SETTINGS_DEFAULT);
    await expect(db.run(asRole(['accounting']), (ctx) => runAction(ctx, 'tax.set_settings', { priceIncludesTax: true }))).rejects.toBeInstanceOf(PermissionDenied);
    await expect(db.run({}, (ctx) => runAction(ctx, 'tax.set_settings', { rounding: { mode: 'banker' } }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'rounding.mode' }] } });
    const set = await db.run(asRole(['settings']), (ctx) => runAction(ctx, 'tax.set_settings', { rounding: { mode: 'half_up' } }));
    expect(set).toEqual({ rounding: { mode: 'half_up', unit: 'invoice' }, priceIncludesTax: false });
    const set2 = await db.run({}, (ctx) => runAction(ctx, 'tax.set_settings', { priceIncludesTax: true }));
    expect(set2).toEqual({ rounding: { mode: 'half_up', unit: 'invoice' }, priceIncludesTax: true });
    expect(await db.run(asRole(['sales']), (ctx) => runAction(ctx, 'tax.get_settings', {}))).toEqual(set2);
    const trail = await db.run({}, (ctx) => auditTrail(ctx, 'company_settings', db.companyId));
    expect(trail.map((t) => Object.keys(t.after ?? {})[0])).toEqual([TAX_PRICE_INCLUDES_TAX_KEY, 'tax.rounding']);
    // back to defaults for the summarize tests
    await db.run({}, (ctx) => runAction(ctx, 'tax.set_settings', { rounding: { mode: 'down', unit: 'invoice' }, priceIncludesTax: false }));
  });

  it('AC-6 tax.resolve uses the company rows; zero-rate categories resolve to 0; missing period -> hint', async () => {
    expect(await db.run(asRole(['viewer']), (ctx) => runAction(ctx, 'tax.resolve', { category: 'standard', date: '2026-09-10' }))).toEqual({ category: 'standard', code: 'STD10', rate: '0.1', label: '標準10%' });
    expect(await db.run({}, (ctx) => runAction(ctx, 'tax.resolve', { category: 'standard', date: '2019-09-30' }))).toMatchObject({ code: 'STD8', rate: '0.08' });
    expect(await db.run({}, (ctx) => runAction(ctx, 'tax.resolve', { category: 'standard', date: '2000-01-01' }))).toMatchObject({ code: 'STD5', rate: '0.05' });
    expect(await db.run({}, (ctx) => runAction(ctx, 'tax.resolve', { category: 'exempt', date: '2026-09-10' }))).toEqual({ category: 'exempt', code: 'EXEMPT', rate: '0', label: '免税' });
    expect(await db.run({}, (ctx) => runAction(ctx, 'tax.resolve', { category: 'out_of_scope', date: '1990-01-01' }))).toMatchObject({ code: 'OOS', rate: '0' });
    await expect(db.run({}, (ctx) => runAction(ctx, 'tax.resolve', { category: 'reduced', date: '2019-09-30' }))).rejects.toMatchObject({ code: 'VALIDATION', hint: 'add a tax_rate row for reduced covering 2019-09-30' });
    await expect(db.run({}, (ctx) => runAction(ctx, 'tax.resolve', { category: 'standard', date: '2026-02-30' }))).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'date' }] } });
    await expect(db.run(asRole(['nobody']), (ctx) => runAction(ctx, 'tax.resolve', { category: 'standard', date: '2026-09-10' }))).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('AC-7 tax.summarize: company rates + rounding setting; priceIncludesTax from setting or input', async () => {
    const lines = [
      { amount: '1234', category: 'standard' },
      { amount: '567', category: 'standard' },
      { amount: '89', category: 'standard' },
      { amount: '1000', category: 'reduced' },
      { amount: '333', category: 'reduced' },
      { amount: '500', category: 'non_taxable' },
    ];
    const down = (await db.run(asRole(['sales']), (ctx) => runAction(ctx, 'tax.summarize', { date: '2026-09-10', lines }))) as Record<string, unknown>;
    expect(down).toMatchObject({
      date: '2026-09-10',
      priceIncludesTax: false,
      rounding: { mode: 'down', unit: 'invoice', scale: 0 },
      groups: [
        { category: 'standard', code: 'STD10', label: '標準10%', rate: '0.1', taxable: '1890', tax: '189', gross: '2079', lineCount: 3 },
        { category: 'reduced', code: 'RED8', label: '軽減8%', rate: '0.08', taxable: '1333', tax: '106', gross: '1439', lineCount: 2 },
        { category: 'non_taxable', code: 'NONTAX', label: '非課税', rate: '0', taxable: '500', tax: '0', gross: '500', lineCount: 1 },
      ],
      totals: { taxable: '3723', tax: '295', gross: '4018' },
    });
    await db.run({}, (ctx) => runAction(ctx, 'tax.set_settings', { rounding: { mode: 'half_up' } }));
    const halfUp = (await db.run({}, (ctx) => runAction(ctx, 'tax.summarize', { date: '2026-09-10', lines }))) as { groups: { tax: string }[]; totals: { tax: string } };
    expect(halfUp.groups.map((g) => g.tax)).toEqual(['189', '107', '0']);
    expect(halfUp.totals.tax).toBe('296');
    // historical date picks the 8% standard rate
    const old = (await db.run({}, (ctx) => runAction(ctx, 'tax.summarize', { date: '2019-09-30', lines: [{ amount: '1000', category: 'standard' }] }))) as { groups: { code: string; tax: string }[] };
    expect(old.groups).toEqual([expect.objectContaining({ code: 'STD8', rate: '0.08', tax: '80' })]);
    // 税込 via input override, then via the company setting
    const incl = (await db.run({}, (ctx) => runAction(ctx, 'tax.summarize', { date: '2026-09-10', priceIncludesTax: true, lines: [{ amount: '1100', category: 'standard' }, { amount: '1540', category: 'reduced' }] }))) as { priceIncludesTax: boolean; groups: { taxable: string; tax: string; gross: string }[] };
    expect(incl.priceIncludesTax).toBe(true);
    expect(incl.groups).toEqual([expect.objectContaining({ taxable: '1000', tax: '100', gross: '1100' }), expect.objectContaining({ taxable: '1426', tax: '114', gross: '1540' })]);
    await db.run({}, (ctx) => runAction(ctx, 'tax.set_settings', { rounding: { mode: 'down' }, priceIncludesTax: true }));
    const inclBySetting = (await db.run({}, (ctx) => runAction(ctx, 'tax.summarize', { date: '2026-09-10', lines: [{ amount: '1100', category: 'standard' }] }))) as { priceIncludesTax: boolean; totals: { tax: string } };
    expect(inclBySetting).toMatchObject({ priceIncludesTax: true, totals: { tax: '100' } });
    await db.run({}, (ctx) => runAction(ctx, 'tax.set_settings', { priceIncludesTax: false }));
    // errors: bad amount, unknown category, no rate for the date
    await expect(db.run({}, (ctx) => runAction(ctx, 'tax.summarize', { date: '2026-09-10', lines: [{ amount: '12.3.4', category: 'standard' }] }))).rejects.toMatchObject({ details: { issues: [{ path: 'lines.0.amount' }] } });
    await expect(db.run({}, (ctx) => runAction(ctx, 'tax.summarize', { date: '2026-09-10', lines: [{ amount: '1', category: 'vat' }] }))).rejects.toMatchObject({ details: { issues: [{ path: 'lines.0.category' }] } });
    await expect(db.run({}, (ctx) => runAction(ctx, 'tax.summarize', { date: '2019-09-30', lines: [{ amount: '1', category: 'reduced' }] }))).rejects.toMatchObject({ hint: 'add a tax_rate row for reduced covering 2019-09-30' });
    await expect(db.run(asRole(['nobody']), (ctx) => runAction(ctx, 'tax.summarize', { date: '2026-09-10', lines }))).rejects.toBeInstanceOf(PermissionDenied);
  });

  it('taxSummaryFor (in-process API for sales/purchase) returns Decimals with code/label per group', async () => {
    const s = await db.run(asRole(['purchasing']), (ctx) => taxSummaryFor(ctx, { date: '2026-09-10', lines: [{ amount: Decimal.from('1235'), category: 'standard' }, { amount: '-333', category: 'reduced' }] }));
    expect(s.rounding).toEqual({ mode: 'down', unit: 'invoice', scale: 0 });
    expect(s.groups.map((g) => [g.code, g.label, g.tax.toString()])).toEqual([
      ['STD10', '標準10%', '123'],
      ['RED8', '軽減8%', '-26'],
    ]);
    expect(s.totals.tax).toBeInstanceOf(Decimal);
    expect(s.totals.gross.toString()).toBe('999');
  });

  it('AC-9 RED1 (reduced 1% from 2027-04-01) is added as data: close RED8, create RED1, resolve switches on the date', async () => {
    const red8 = await db.run({}, async (ctx) => (await repo(ctx, TaxRate).list({ where: { code: 'RED8' } })).items[0]);
    const red8id = red8?.id ?? '';
    // creating RED1 before closing RED8 is the overlap error
    await expect(db.run({}, (ctx) => repo(ctx, TaxRate).create({ code: 'RED1', category: 'reduced', rate: '0.01', validFrom: '2027-04-01', validTo: '2029-03-31', label: '軽減1%' }))).rejects.toMatchObject({ message: expect.stringContaining('RED8') });
    await db.run({}, (ctx) => repo(ctx, TaxRate).update(red8id, { validTo: '2027-03-31' }));
    await db.run({}, (ctx) => repo(ctx, TaxRate).create({ code: 'RED1', category: 'reduced', rate: '0.01', validFrom: '2027-04-01', validTo: '2029-03-31', label: '軽減1%' }));
    expect(await db.run({}, (ctx) => runAction(ctx, 'tax.resolve', { category: 'reduced', date: '2027-03-31' }))).toMatchObject({ code: 'RED8', rate: '0.08' });
    expect(await db.run({}, (ctx) => runAction(ctx, 'tax.resolve', { category: 'reduced', date: '2027-04-01' }))).toMatchObject({ code: 'RED1', rate: '0.01' });
    const s = (await db.run({}, (ctx) => runAction(ctx, 'tax.summarize', { date: '2027-04-01', lines: [{ amount: '1000', category: 'reduced' }] }))) as { groups: { code: string; tax: string }[] };
    expect(s.groups).toEqual([expect.objectContaining({ code: 'RED1', rate: '0.01', tax: '10' })]);
  });
});
