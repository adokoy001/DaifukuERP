import { describe, expect, it } from 'vitest';
import type { ActionMeta } from '../api/types.ts';
import { refResolverFrom, schemaFields } from './schema.ts';
import {
  extraInputSchema,
  htmlOf,
  printActionsFor,
  printFieldPresentation,
  printInputOf,
  withPrintBar,
  type PrintAction,
} from './print.ts';

function action(name: string, over: Partial<ActionMeta> = {}): ActionMeta {
  return {
    name,
    module: name.split('.')[0] ?? '',
    description: { ja: name, en: name },
    generic: false,
    mutates: false,
    resultKind: 'other',
    ...over,
  };
}

const idSchema = { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] };
const invoicePrint = { entity: 'sales_invoice', label: { ja: '請求書を表示', en: 'View invoice' }, idInput: 'id' };
const invoice = action('sales.render_invoice_html', { inputSchema: idSchema, print: invoicePrint });
const receipt = action('payment.render_receipt_html', {
  inputSchema: idSchema,
  print: {
    entity: 'payment',
    label: { ja: '領収書を表示', en: 'View receipt' },
    idInput: 'id',
    when: { direction: 'receive' },
  },
});
const notice = action('payment.render_payment_notice_html', {
  inputSchema: idSchema,
  print: {
    entity: 'payment',
    label: { ja: '支払通知書を表示', en: 'View payment notice' },
    idInput: 'id',
    when: { direction: 'pay' },
  },
});
const statement = action('sales.render_statement_html', {
  inputSchema: {
    type: 'object',
    properties: { partnerId: { type: 'string', format: 'uuid' }, closingDate: { type: 'string', format: 'date' } },
    required: ['partnerId'],
  },
  print: {
    entity: 'partner',
    label: { ja: '合計請求書を表示', en: 'View statement' },
    idInput: 'partnerId',
    when: { isCustomer: true },
    fields: {
      closingDate: {
        label: { ja: '締め日', en: 'Closing date' },
        description: { ja: '空欄なら直近の締め日', en: 'Blank for the latest closing date' },
      },
    },
  },
});
const doc = (name: string) => ({ name, kind: 'document' as const });
const all = [action('sales.ar_aging', { resultKind: 'table' }), invoice, receipt, notice, statement];

describe('printActionsFor (print-templates AC-3: declared in /meta, no web table)', () => {
  it('AC-3 finds the actions declared for the entity, only on submitted documents', () => {
    expect(printActionsFor(doc('sales_invoice'), { docstatus: 1 }, all)).toEqual([invoice]);
    expect(printActionsFor(doc('sales_invoice'), { docstatus: 0 }, all)).toEqual([]);
    expect(printActionsFor(doc('sales_invoice'), { docstatus: 2 }, all)).toEqual([]);
    expect(printActionsFor(doc('purchase_invoice'), { docstatus: 1 }, all)).toEqual([]);
  });

  it('AC-3 `when` picks the receipt or the payment notice by direction (one entity, two documents)', () => {
    expect(printActionsFor(doc('payment'), { docstatus: 1, direction: 'receive' }, all)).toEqual([receipt]);
    expect(printActionsFor(doc('payment'), { docstatus: 1, direction: 'pay' }, all)).toEqual([notice]);
    expect(printActionsFor(doc('payment'), { docstatus: 1 }, all)).toEqual([]);
  });

  it('AC-3 plain entities (partner) need no docstatus; `when` compares booleans', () => {
    const partner = { name: 'partner', kind: 'entity' as const };
    expect(printActionsFor(partner, { isCustomer: true }, all)).toEqual([statement]);
    expect(printActionsFor(partner, { isCustomer: false }, all)).toEqual([]);
  });

  it('AC-3 an action whose input lacks the idInput property is not offered; several matches keep /meta order', () => {
    const broken = action('sales.render_invoice_html', {
      inputSchema: { type: 'object', properties: { invoiceId: {} } },
      print: invoicePrint,
    });
    expect(printActionsFor(doc('sales_invoice'), { docstatus: 1 }, [broken])).toEqual([]);
    expect(printActionsFor(doc('sales_invoice'), { docstatus: 1 }, [action('sales.render_invoice_html')])).toEqual([]);
    const second = action('pack.render_invoice_copy_html', { inputSchema: idSchema, print: invoicePrint });
    expect(printActionsFor(doc('sales_invoice'), { docstatus: 1 }, [second, invoice]).map((a) => a.name)).toEqual([
      'pack.render_invoice_copy_html',
      'sales.render_invoice_html',
    ]);
  });
});

describe('print input (print-templates AC-4)', () => {
  it('AC-4 the record id goes under idInput; extra values are kept but cannot override it', () => {
    expect(printInputOf(invoice as PrintAction, 'inv-1')).toEqual({ id: 'inv-1' });
    expect(printInputOf(statement as PrintAction, 'p-1', { closingDate: '2026-10-20', partnerId: 'x' })).toEqual({
      closingDate: '2026-10-20',
      partnerId: 'p-1',
    });
  });

  it('AC-4 extraInputSchema: undefined without extra inputs; otherwise the schema without idInput', () => {
    expect(extraInputSchema(invoice as PrintAction)).toBeUndefined();
    expect(extraInputSchema(statement as PrintAction)).toEqual({
      type: 'object',
      properties: { closingDate: { type: 'string', format: 'date' } },
    });
  });

  it('AC-4 AC-25 the dialog fields are labelled in ja and en by print.fields (not by the schema title)', () => {
    const fields = schemaFields(
      extraInputSchema(statement as PrintAction),
      refResolverFrom([]),
      printFieldPresentation(statement as PrintAction),
    );
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      name: 'closingDate',
      kind: 'date',
      required: false,
      label: { ja: '締め日', en: 'Closing date' },
      help: { ja: '空欄なら直近の締め日', en: 'Blank for the latest closing date' },
    });
    expect(printFieldPresentation(invoice as PrintAction)).toBeUndefined();
  });
});

describe('htmlOf', () => {
  it('accepts { html: non-empty string } only', () => {
    expect(htmlOf({ html: '<p>x</p>' })).toBe('<p>x</p>');
    expect(htmlOf({ html: '  ' })).toBeUndefined();
    expect(htmlOf({ html: 1 })).toBeUndefined();
    expect(htmlOf('<p>x</p>')).toBeUndefined();
    expect(htmlOf(null)).toBeUndefined();
  });
});

describe('withPrintBar', () => {
  const labels = { print: '印刷', close: '閉じる' };
  const origin = 'https://erp.example.test';
  it('inserts the bar right after <body> and keeps the rest of the document', () => {
    const out = withPrintBar(
      '<!doctype html><html><head><title>t</title></head><body class="a4"><h1>請求書</h1></body></html>',
      labels,
      origin,
    );
    expect(out.indexOf('<div class="daifuku-print-bar">')).toBeGreaterThan(out.indexOf('<body class="a4">'));
    expect(out.indexOf('<div class="daifuku-print-bar">')).toBeLessThan(out.indexOf('<h1>'));
    expect(out).toContain('data-daifuku-print="print">印刷<');
    expect(out).toContain('<script src="https://erp.example.test/print-controls.js" defer></script>');
    expect(out).not.toContain('onclick=');
    expect(out).toContain('@media print{.daifuku-print-bar{display:none}}');
    expect(out.endsWith('</body></html>')).toBe(true);
  });
  it('prepends the bar to a fragment without <body>, and escapes labels', () => {
    const out = withPrintBar('<h1>x</h1>', { print: 'A<b>', close: '"q"' }, origin);
    expect(out.startsWith('<style>')).toBe(true);
    expect(out.endsWith('<h1>x</h1>')).toBe(true);
    expect(out).toContain('>A&lt;b&gt;<');
    expect(out).toContain('>&quot;q&quot;<');
  });
  it('accepts the development origin but refuses non-origin and executable asset inputs', () => {
    expect(withPrintBar('<h1>x</h1>', labels, 'http://localhost:5173')).toContain(
      'src="http://localhost:5173/print-controls.js"',
    );
    for (const input of ['javascript:alert(1)', 'data:text/javascript,x', `${origin}/path`, `${origin}?token=x`])
      expect(() => withPrintBar('<h1>x</h1>', labels, input)).toThrow();
  });
});
