import { describe, expect, it } from 'vitest';
import { newId } from '@daifuku/kernel';
import { billInput, boardInput, fulfillInput } from '../src/contract.ts';
import { positiveQuantity } from '../src/internal.ts';
describe('trade command boundary', () => {
  it('requires exact positive quantities with at most six decimal places', () => {
    const base = { orderId: newId(), expectedVersion: 1, date: '2026-09-12', warehouseId: newId(), requestId: newId() },
      orderLineId = newId();
    for (const quantity of ['0', '-1', '0.0000001', '1e3', 'NaN'])
      expect(fulfillInput.safeParse({ ...base, lines: [{ orderLineId, quantity }] }).success).toBe(false);
    expect(fulfillInput.parse({ ...base, lines: [{ orderLineId, quantity: '0.000001' }] }).lines[0]?.quantity).toBe(
      '0.000001',
    );
    expect(() => positiveQuantity('0.0000001')).toThrow();
    expect(positiveQuantity('1.250000').toString()).toBe('1.25');
  });
  it('bounds batch sizes and supplier invoice length before persistence', () => {
    const input = {
      fulfillmentId: newId(),
      expectedVersion: 1,
      date: '2026-09-12',
      requestId: newId(),
      lines: [{ fulfillmentLineId: newId(), quantity: '1' }],
    };
    expect(billInput.safeParse({ ...input, lines: Array.from({ length: 501 }, () => input.lines[0]) }).success).toBe(
      false,
    );
    expect(billInput.safeParse({ ...input, supplierInvoiceNo: 'x'.repeat(51) }).success).toBe(false);
    expect(billInput.safeParse({ ...input, sourceEntity: 'sales_invoice' }).success).toBe(false);
    expect(boardInput.parse({ direction: 'sales' })).toMatchObject({ status: 'open', limit: 50, offset: 0 });
  });
});
