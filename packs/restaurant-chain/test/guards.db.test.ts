import { newId, PermissionDenied, StateError, ValidationError } from '@daifuku/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closing, setup, stock, submit, type Fixture, type Page } from './fixture.ts';

let s: Fixture;
beforeAll(async () => {
  s = await setup();
});
afterAll(async () => {
  await s?.db.close();
});

describe('飲食店の日次締め整合性', () => {
  it('入金内訳不一致と材料不足は売上・入金・出庫を残さずロールバックする', async () => {
    const mismatch = await closing(s, 'RC-A', { cashAmount: '9999' });
    await expect(submit(s, mismatch)).rejects.toBeInstanceOf(ValidationError);
    const insufficient = await closing(s);
    await expect(submit(s, insufficient)).rejects.toThrow();
    for (const entity of ['sales_invoice', 'payment', 'stock_entry', 'stock_ledger'])
      expect((await s.act<Page>(`${entity}.list`, {})).total).toBe(0);
    expect(await s.act('restaurant_chain_closing.get', { id: insufficient.id })).toMatchObject({
      docstatus: 0,
      salesInvoiceId: null,
      consumptionEntryId: null,
    });
  });
  it('二件の同日同店舗の同時確定は一件だけ成功し、直接計算値・発生先の書換えも拒否する', async () => {
    await stock(s, 'RC-A');
    const left = await closing(s),
      right = await closing(s);
    const outcomes = await Promise.allSettled([submit(s, left), submit(s, right)]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await s.act<Page>('sales_invoice.list', {})).total).toBe(1);
    const current = (await s.act<Page>('restaurant_chain_closing.list', { where: { docstatus: 1 } })).items[0];
    await expect(
      s.act('restaurant_chain_closing.update', { id: current?.id, patch: { total: '1' } }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      s.act('restaurant_chain_closing.update', { id: current?.id, patch: { salesInvoiceId: null } }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(
      s.act('restaurant_chain_closing.update', { id: current?.id, patch: { storeId: s.ids['RC-B'] } }),
    ).rejects.toBeInstanceOf(StateError);
    const lines = await s.act<Page>('restaurant_chain_closing_line.list', { where: { closingId: current?.id } });
    await expect(s.act('restaurant_chain_closing_line.delete', { id: lines.items[0]?.id })).rejects.toThrow();
    await expect(
      s.act('restaurant_chain_closing.cancel', { id: current?.id, correctionDate: '2026-09-11' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
  it('salesのみは材料出庫できず、sales+inventoryは確定できる（取消はaccountingも必要）', async () => {
    await stock(s, 'RC-B');
    const draft = await closing(s, 'RC-B');
    await expect(
      s.act('restaurant_chain_closing.submit', { id: draft.id }, { roles: ['sales'] }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    expect(await s.act('restaurant_chain_closing.get', { id: draft.id })).toMatchObject({
      docstatus: 0,
      salesInvoiceId: null,
    });
    const posted = await s.act('restaurant_chain_closing.submit', { id: draft.id }, { roles: ['sales', 'inventory'] });
    await expect(
      s.act('restaurant_chain_closing.cancel', { id: posted.id }, { roles: ['sales', 'inventory'] }),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await s.act('restaurant_chain_closing.cancel', { id: posted.id }, { roles: ['sales', 'inventory', 'accounting'] });
    await expect(
      s.act('restaurant_chain_closing.create', { storeId: s.ids['RC-B'] }, { roles: ['viewer'] }),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
  it('確定レシピの材料変更と使用済みレシピ取消を拒否し、新しい版を作れる', async () => {
    const recipeId = s.ids['RC-CURRY-V1'];
    const ingredient = (await s.act<Page>('restaurant_chain_recipe_ingredient.list', { where: { recipeId } })).items[0];
    await expect(
      s.act('restaurant_chain_recipe_ingredient.update', { id: ingredient?.id, patch: { quantity: '0.9' } }),
    ).rejects.toBeInstanceOf(StateError);
    await expect(s.act('restaurant_chain_recipe.cancel', { id: recipeId })).rejects.toBeInstanceOf(StateError);
    const draft = await s.act('restaurant_chain_recipe.create', {
      code: 'RC-CURRY-V2',
      name: '新配合',
      productId: s.ids['RC-CURRY'],
      unitPrice: '1200',
      lines: { restaurant_chain_recipe_ingredient: [{ productId: s.ids['RC-RICE'], quantity: '0.3' }] },
    });
    await expect(
      closing(s, 'RC-B', { lines: { restaurant_chain_closing_line: [{ recipeId: draft.id, quantity: '1' }] } }),
    ).rejects.toBeInstanceOf(StateError);
    await s.act('restaurant_chain_recipe.submit', { id: draft.id });
    await expect(
      s.act('restaurant_chain_recipe_ingredient.create', {
        recipeId: draft.id,
        productId: s.ids['RC-CURRY'],
        quantity: '1',
      }),
    ).rejects.toThrow();
    const change = await closing(s, 'RC-B', { date: '2026-09-14' });
    const line = (await s.act<Page>('restaurant_chain_closing_line.list', { where: { closingId: change.id } }))
      .items[0];
    const updated = await s.act('restaurant_chain_closing_line.update', {
      id: line?.id,
      patch: { recipeId: draft.id },
    });
    expect(updated).toMatchObject({ unitPrice: '1200', description: '新配合' });
  });
  it('持帰りの酒類は標準税率になり、同じ税込1100円が税抜1000円・税100円になる', async () => {
    const menu = await s.act('product.create', { code: 'RC-BEER', name: '瓶ビール（販売メニュー）', kind: 'service' });
    const recipe = await s.act('restaurant_chain_recipe.create', {
      code: 'RC-BEER-V1',
      name: '瓶ビール v1',
      productId: menu.id,
      unitPrice: '1100',
      alcohol: true,
      lines: { restaurant_chain_recipe_ingredient: [{ productId: s.ids['RC-RICE'], quantity: '0.1' }] },
    });
    await s.act('restaurant_chain_recipe.submit', { id: recipe.id });
    const draft = await closing(s, 'RC-B', {
      date: '2026-09-13',
      cashAmount: '1100',
      cardAmount: '0',
      qrAmount: '0',
      lines: { restaurant_chain_closing_line: [{ recipeId: recipe.id, serviceMode: 'takeaway', quantity: '1' }] },
    });
    expect(draft).toMatchObject({ subtotal: '1000', taxTotal: '100', total: '1100' });
    const lines = await s.act<Page>('restaurant_chain_closing_line.list', { where: { closingId: draft.id } });
    expect(lines.items[0]).toMatchObject({ taxCategory: 'standard', unitPrice: '1100' });
  });
  it('同一テナントの別会社では店舗・レシピ・締め・集計を参照できない', async () => {
    const companyId = newId();
    await s.db.owner
      .sql`insert into companies (id, tenant_id, code, name) values (${companyId}, ${s.db.tenantId}, 'RC-OTHER', '別法人')`;
    // Apply without sample: no core master dependencies or foreign company data are copied.
    await s.act('pack.apply', { name: 'restaurant_chain' }, { companyId });
    expect((await s.act<Page>('restaurant_chain_store.list', {}, { companyId })).total).toBe(0);
    await expect(s.act('restaurant_chain_store.get', { id: s.ids['RC-A'] }, { companyId })).rejects.toThrow();
    await expect(
      s.act('restaurant_chain_closing.create', { storeId: s.ids['RC-A'], date: '2026-09-12' }, { companyId }),
    ).rejects.toThrow();
    const report = await s.act<{ rows: unknown[] }>(
      'restaurant_chain.daily_summary',
      { from: '2026-09-01', to: '2026-10-31' },
      { companyId },
    );
    expect(report.rows).toEqual([]);
    await expect(
      s.act(
        'restaurant_chain.daily_summary',
        { from: '2026-09-01', to: '2026-10-31', storeId: s.ids['RC-A'] },
        { companyId },
      ),
    ).rejects.toThrow();
  });
});
