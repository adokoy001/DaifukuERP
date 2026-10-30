// docs/specs/print-templates.md AC-1 / AC-2: the `print` declaration of a document render action, its definition-time
// checks, and how /meta (appMeta) emits it.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Context, Db } from '../src/context.ts';
import { makeContext } from '../src/db/client.ts';
import { defineAction, PRINT_ACTION_RE } from '../src/dsl/action.ts';
import type { ActionConfig } from '../src/dsl/defs.ts';
import { label } from '../src/i18n.ts';
import { appMeta, printBindingMeta } from '../src/meta.ts';

const html = z.object({ html: z.string() });

function config(over: Partial<ActionConfig<z.ZodType, z.ZodType>> = {}): ActionConfig<z.ZodType, z.ZodType> {
  return {
    name: 'test_print.render_widget_html',
    description: label('ウィジェットの帳票', 'Widget document'),
    input: z.object({ id: z.uuid() }),
    output: html,
    permission: 'authenticated',
    tx: 'none',
    mutates: false,
    print: { entity: 'test_widget', label: label('ウィジェットを表示', 'View widget') },
    handler: async () => ({ html: '<p>x</p>' }),
    ...over,
  };
}

const plain = defineAction(config());
const statement = defineAction(
  config({
    name: 'test_print.render_summary_html',
    input: z.object({ partnerId: z.uuid(), closingDate: z.iso.date().optional() }),
    permission: { roles: ['print_probe'] },
    print: {
      entity: 'test_partner',
      label: label('まとめを表示', 'View summary'),
      idInput: 'partnerId',
      when: { isCustomer: true },
      fields: {
        closingDate: { label: label('締め日', 'Closing date'), description: label('空欄=直近', 'Blank=latest') },
      },
    },
  }),
);

function ctxWith(roles: string[]): Context {
  return makeContext({} as unknown as Db, {
    tenantId: '00000000-0000-0000-0000-000000000001',
    companyId: null,
    actor: { type: 'user', id: 'u-1' },
    roles,
  });
}

describe('print declaration: definition-time checks (AC-1)', () => {
  it('AC-1 accepts a render action and keeps the declaration on the definition', () => {
    expect(plain.print?.entity).toBe('test_widget');
    expect(statement.print?.idInput).toBe('partnerId');
  });

  it('AC-1 the naming convention is <module>.render_<document>_html', () => {
    expect(PRINT_ACTION_RE.test('sales.render_invoice_html')).toBe(true);
    expect(PRINT_ACTION_RE.test('trade.render_delivery_note_html')).toBe(true);
    expect(PRINT_ACTION_RE.test('sales.invoice_html')).toBe(false);
    expect(PRINT_ACTION_RE.test('sales.render_invoice')).toBe(false);
    expect(() => defineAction(config({ name: 'test_print.show_widget' }))).toThrow(/render_<document>_html/);
  });

  it('AC-1 refuses tx required, mutating and internal render actions', () => {
    expect(() => defineAction(config({ name: 'test_print.render_a_html', tx: 'required' }))).toThrow(/tx must be/);
    expect(() => defineAction(config({ name: 'test_print.render_b_html', tx: undefined }))).toThrow(/tx must be/);
    expect(() => defineAction(config({ name: 'test_print.render_c_html', mutates: true }))).toThrow(/mutate/);
    expect(() => defineAction(config({ name: 'test_print.render_d_html', internal: true }))).toThrow(/internal/);
  });

  it('AC-1 the input must be an object with the idInput property', () => {
    expect(() => defineAction(config({ name: 'test_print.render_e_html', input: z.string() }))).toThrow(/zod object/);
    expect(() =>
      defineAction(config({ name: 'test_print.render_f_html', input: z.object({ invoiceId: z.uuid() }) })),
    ).toThrow(/no "id" property/);
    expect(() =>
      defineAction(
        config({
          name: 'test_print.render_g_html',
          print: { entity: 'test_widget', label: label('x', 'x'), idInput: 'widgetId' },
        }),
      ),
    ).toThrow(/no "widgetId" property/);
  });

  it('AC-1 fields keys must be extra input properties (not idInput, not unknown)', () => {
    const input = z.object({ id: z.uuid(), asOf: z.iso.date().optional() });
    const field = { label: label('基準日', 'As of') };
    expect(() =>
      defineAction(
        config({
          name: 'test_print.render_h_html',
          input,
          print: { entity: 'test_widget', label: label('x', 'x'), fields: { id: field } },
        }),
      ),
    ).toThrow(/fields\.id/);
    expect(() =>
      defineAction(
        config({
          name: 'test_print.render_i_html',
          input,
          print: { entity: 'test_widget', label: label('x', 'x'), fields: { nope: field } },
        }),
      ),
    ).toThrow(/fields\.nope/);
    const ok = defineAction(
      config({
        name: 'test_print.render_j_html',
        input,
        print: { entity: 'test_widget', label: label('x', 'x'), fields: { asOf: field } },
      }),
    );
    expect(ok.print?.fields?.asOf?.label.en).toBe('As of');
  });

  it('AC-1 actions without print keep the old rules (no naming constraint)', () => {
    const other = defineAction(config({ name: 'test_print.list_widgets', print: undefined, tx: 'required' }));
    expect(other.print).toBeUndefined();
  });
});

describe('print declaration in /meta (AC-2)', () => {
  it('AC-2 appMeta emits actions[].print with the idInput default filled in', () => {
    const actions = appMeta(ctxWith(['admin'])).actions;
    expect(actions.find((a) => a.name === plain.name)?.print).toEqual({
      entity: 'test_widget',
      label: { ja: 'ウィジェットを表示', en: 'View widget' },
      idInput: 'id',
    });
    expect(actions.find((a) => a.name === statement.name)?.print).toEqual({
      entity: 'test_partner',
      label: { ja: 'まとめを表示', en: 'View summary' },
      idInput: 'partnerId',
      when: { isCustomer: true },
      fields: {
        closingDate: {
          label: { ja: '締め日', en: 'Closing date' },
          description: { ja: '空欄=直近', en: 'Blank=latest' },
        },
      },
    });
    expect(actions.find((a) => a.name === 'test_print.list_widgets')).not.toHaveProperty('print');
  });

  it('AC-2 an action the caller cannot run is not listed, so neither is its print declaration', () => {
    expect(appMeta(ctxWith(['viewer'])).actions.map((a) => a.name)).not.toContain(statement.name);
    expect(appMeta(ctxWith(['print_probe'])).actions.find((a) => a.name === statement.name)?.print?.idInput).toBe(
      'partnerId',
    );
  });

  it('AC-2 printBindingMeta omits undeclared when / fields', () => {
    expect(printBindingMeta({ entity: 'e', label: label('a', 'a') })).toEqual({
      entity: 'e',
      label: { ja: 'a', en: 'a' },
      idInput: 'id',
    });
  });
});
