// docs/specs/print-templates.md AC-1, AC-19: what defineAction cannot check at definition time (entities may register
// later) is checked here over the whole runtime catalog: every `print` declaration names a registered entity, `when`
// keys are fields of it, the id property is a uuid string and `fields` keys are input properties — on the same JSON
// Schema that /meta sends to the web (apps/api toJsonSchema) —, its permission is `{ entity, op: 'read' }` on a
// registered entity, and no action named like a render action lacks the declaration.
import { PRINT_ACTION_RE, registry } from '@daifuku/kernel';
import { loadRuntime } from '@daifuku/runtime';
import { beforeAll, describe, expect, it } from 'vitest';
import { toJsonSchema } from '../src/routes/meta.ts';

beforeAll(async () => {
  await loadRuntime({ schema: true });
}, 60_000);

type Json = { type?: string; format?: string; properties?: Record<string, Json> };

describe('print declarations of the runtime catalog (AC-1)', () => {
  it('AC-1 the documents of this item are declared (and nothing else uses the convention without print)', () => {
    const printed = registry
      .actions()
      .filter((a) => a.print)
      .map((a) => a.name)
      .sort();
    expect(printed).toEqual(
      expect.arrayContaining([
        'payment.render_payment_notice_html',
        'payment.render_receipt_html',
        'sales.render_invoice_html',
        'sales.render_statement_html',
        'trade.render_delivery_note_html',
        'trade.render_order_html',
        'trade.render_quotation_html',
        'workforce.render_payslip_html',
      ]),
    );
    const undeclared = registry
      .actions()
      .filter((a) => PRINT_ACTION_RE.test(a.name) && !a.print)
      .map((a) => a.name);
    expect(undeclared).toEqual([]);
  });

  it('AC-1 AC-19 every print declaration names a registered entity, its fields, a uuid id property and a read permission', () => {
    const problems: string[] = [];
    for (const action of registry.actions()) {
      const print = action.print;
      if (!print) continue;
      if (!registry.hasEntity(print.entity)) {
        problems.push(`${action.name}: entity ${print.entity} is not registered`);
        continue;
      }
      const entity = registry.entity(print.entity);
      for (const key of Object.keys(print.when ?? {}))
        if (!entity.fieldNames.includes(key)) problems.push(`${action.name}: when.${key} is not a field`);
      const schema = toJsonSchema(action.input, 'input') as Json | undefined;
      const idInput = print.idInput ?? 'id';
      const id = schema?.properties?.[idInput];
      if (id?.type !== 'string' || id.format !== 'uuid')
        problems.push(`${action.name}: ${idInput} is not a uuid string`);
      for (const key of Object.keys(print.fields ?? {}))
        if (!schema?.properties?.[key]) problems.push(`${action.name}: fields.${key} is not an input property`);
      // AC-19: the button follows /meta, which lists an action only for callers with read on its entity.
      const permission = action.permission;
      if (permission === 'authenticated' || !('entity' in permission) || permission.op !== 'read')
        problems.push(`${action.name}: permission must be { entity, op: 'read' } (AC-19)`);
      else if (!registry.hasEntity(permission.entity))
        problems.push(`${action.name}: permission entity ${permission.entity} is not registered`);
    }
    expect(problems).toEqual([]);
  });
});
