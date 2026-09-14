import { describe, expect, it } from 'vitest';
import type { ActionMeta } from '../api/types.ts';
import { htmlOf, printActionFor, withPrintBar } from './print.ts';

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

const render = action('sales.render_invoice_html', {
  inputSchema: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
});

describe('printActionFor (web-polish print view, data-driven from /meta)', () => {
  it('finds <module>.render_invoice_html whose input takes { id }', () => {
    expect(printActionFor({ module: 'sales' }, [action('sales.ar_aging', { resultKind: 'table' }), render])).toBe(
      render,
    );
  });
  it('ignores other modules, entities without a module, and actions without an id input', () => {
    expect(printActionFor({ module: 'purchase' }, [render])).toBeUndefined();
    expect(printActionFor({ module: undefined }, [render])).toBeUndefined();
    expect(printActionFor({ module: 'sales' }, [action('sales.render_invoice_html')])).toBeUndefined();
    expect(
      printActionFor({ module: 'sales' }, [
        action('sales.render_invoice_html', {
          inputSchema: { type: 'object', properties: { invoiceId: { type: 'string' } } },
        }),
      ]),
    ).toBeUndefined();
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
