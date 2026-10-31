// Postgres tests of the size limits (docs/specs/fixed-assets.md AC-9, AC-21, AC-22; docs/conventions/reports.md): the
// reports cap their rows at MAX_REPORT_ROWS with meta.truncated and totals over every row, and the booked history
// refuses to sum partially when one fiscal year has more booked assets than one aggregate returns. Rows are inserted
// through the owner connection (a run of more than 500 assets cannot be booked through the module). Test DB:
// TEST_DATABASE_URL*. Today is 2027-09-15 (JST); fiscal years run April–March (FY2026, FY2027).
import { MAX_REPORT_ROWS, StateError } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HISTORY_GROUP_LIMIT } from '../src/services/history.ts';
import { caught, setupEnv, type Env, type Row } from './db-setup.ts';

const NOW = new Date('2027-09-15T03:00:00Z');
const COUNT = MAX_REPORT_ROWS + 1;
let env: Env;
type Table = { title: { ja: string; en: string }; rows: Row[]; totals?: Record<string, string>; meta?: Row };

beforeAll(async () => {
  env = await setupEnv(NOW, { fiscalYears: ['2026-04-01', '2027-04-01'] });
  const [asset, accumulated, expense] = [
    await env.account('1925'),
    await env.account('1929'),
    await env.account('6700'),
  ];
  const { tenantId, companyId } = env.db;
  await env.db.owner.sql`
    insert into fixed_asset (id, tenant_id, company_id, code, name, asset_class, acquisition_date, in_service_date,
      cost, method, useful_life, asset_account_id, accumulated_account_id, expense_account_id, municipality,
      property_tax_class, status, depreciation_start)
    select gen_random_uuid(), ${tenantId}, ${companyId}, 'S' || lpad(i::text, 5, '0'), 'bulk', 'tools_furniture',
      '2026-10-01', '2026-10-15', 600000, 'straight_line', 5, ${asset}, ${accumulated}, ${expense}, 'M' || i,
      'tools', 'active', '2026-10-01'
    from generate_series(1, ${COUNT}) as i`;
});
afterAll(async () => {
  await env.db.close();
});

describe('report row cap (AC-21, AC-22)', () => {
  it('AC-21: the schedule returns the first 10,000 rows with meta.truncated; the totals cover every asset', async () => {
    const t = await env.act<Table>('fixed_assets.depreciation_schedule', {});
    expect(t.rows).toHaveLength(MAX_REPORT_ROWS);
    expect(t.meta).toMatchObject({ truncated: true, totalRows: COUNT, fiscalYearCode: 'FY2027' });
    expect(t.totals?.cost).toBe(String(600_000 * COUNT));
    expect(t.title.ja).toContain('先頭 10,000 行');
  });

  it('AC-22: the property-tax aggregate caps its municipality × class rows the same way', async () => {
    const t = await env.act<Table>('fixed_assets.property_tax_summary', { year: 2027 });
    expect(t.rows).toHaveLength(MAX_REPORT_ROWS);
    expect(t.meta).toMatchObject({ truncated: true, totalRows: COUNT });
    expect(t.totals?.totalCost).toBe(String(600_000 * COUNT));
  });
});

describe('booked history range (AC-9)', () => {
  it('AC-9: more booked assets in one fiscal year than one aggregate returns refuses the preview (no partial sums)', async () => {
    expect(COUNT).toBeGreaterThan(HISTORY_GROUP_LIMIT);
    const { tenantId, companyId } = env.db;
    const runId = crypto.randomUUID();
    const [period] = await env.db.owner.sql<{ id: string; fiscal_year_id: string }[]>`
      select id, fiscal_year_id from fiscal_period where company_id = ${companyId} and code = '2026-10'`;
    await env.db.owner.sql`
      insert into depreciation_run (id, tenant_id, company_id, docstatus, number, period_id, fiscal_year_id, date,
        total_amount, asset_count)
      values (${runId}, ${tenantId}, ${companyId}, 1, 'DR-BULK', ${period?.id ?? null}, ${period?.fiscal_year_id ?? null},
        '2026-10-31', ${10_000 * COUNT}, ${COUNT})`;
    await env.db.owner.sql`
      insert into depreciation_run_line (id, tenant_id, company_id, run_id, seq, asset_id, period_id, fiscal_year_id,
        date, amount, annual_amount, expense_account_id, accumulated_account_id)
      select gen_random_uuid(), ${tenantId}, ${companyId}, ${runId}, row_number() over (order by a.code), a.id,
        ${period?.id ?? null}, ${period?.fiscal_year_id ?? null}, '2026-10-31', 10000, 60000, a.expense_account_id,
        a.accumulated_account_id
      from fixed_asset a where a.company_id = ${companyId}`;
    const e = await caught(env.act('fixed_assets.preview_depreciation', { periodId: await env.periodId('2026-11') }));
    expect(e).toBeInstanceOf(StateError);
    expect((e as StateError).details?.reason).toBe('history_too_large');
  });
});
