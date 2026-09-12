// docs/specs/kernel-phase15.md A/F (ext fields) and E (currencyScale / money scale) — definition-time and schema behaviour, no DB.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registerCrudActions } from '../src/actions/crud.ts';
import type { Context, Db } from '../src/context.ts';
import { makeContext } from '../src/db/client.ts';
import { defineEntity } from '../src/dsl/entity.ts';
import { f, type AnyField } from '../src/dsl/fields.ts';
import { Conflict, DependencyError, ValidationError } from '../src/errors.ts';
import { validateExt } from '../src/ext.ts';
import { label } from '../src/i18n.ts';
import { entityMeta, extFieldMetas, fieldMeta } from '../src/meta.ts';
import { registry } from '../src/registry.ts';
import { currencyScale } from '../src/settings.ts';
import { TMemo, TMemoLine, TPartner } from './fixtures/entities.ts';

const ExtItem = defineEntity({
  name: 'ext_unit_item',
  label: label('ext 単体テスト品目', 'Ext unit item'),
  fields: { name: f.text({ required: true }), price: f.money(), rate: f.decimal({ scale: 4 }), qty: f.quantity() },
  permissions: { roles: { clerk: ['read', 'create'] } },
});
const NoExt = defineEntity({ name: 'ext_unit_plain', label: label('ext なし', 'No ext'), ext: false, fields: { name: f.text() }, permissions: { roles: { clerk: ['read'] } } });
const FreeExt = defineEntity({ name: 'ext_unit_free', label: label('ext 未登録', 'Unregistered ext'), fields: { name: f.text() }, permissions: { roles: { clerk: ['read'] } } });

// fixture entities are registered by the import above; the generic actions let us inspect documented inputs
registerCrudActions();

const ctx: Context = makeContext({} as unknown as Db, { tenantId: '00000000-0000-0000-0000-000000000001', companyId: null, actor: { type: 'user', id: 'u' }, roles: ['admin'] });

function caught(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
}
const issuesOf = (e: unknown) => ((e as ValidationError).details as { issues: { path: string; message: string }[] }).issues;

describe('registerExt (AC-1, AC-12)', () => {
  it('AC-1 stores fields per entity with their source; extVersion changes on each registration', () => {
    expect(registry.extFields(ExtItem.name)).toEqual([]);
    expect(registry.extVersion(ExtItem.name)).toBe(0);
    registry.registerExt(ExtItem.name, { jan: f.text({ searchable: true, label: label('JAN', 'JAN'), maxLength: 13 }) }, { source: 'pack_a' });
    const v1 = registry.extVersion(ExtItem.name);
    expect(v1).toBeGreaterThan(0);
    registry.registerExt(ExtItem.name, { grade: f.enum(['a', 'b'], { required: true }) }, { source: 'pack_b' });
    expect(registry.extVersion(ExtItem.name)).toBeGreaterThan(v1);
    expect(registry.extFields(ExtItem.name).map((d) => [d.key, d.field.kind, d.source])).toEqual([
      ['jan', 'text', 'pack_a'],
      ['grade', 'enum', 'pack_b'],
    ]);
  });

  it('AC-1 the same key twice for one entity -> Conflict whose hint names both sources; nothing from that call is added', () => {
    const e = caught(() => registry.registerExt(ExtItem.name, { color: f.text(), jan: f.text() }, { source: 'pack_c' }));
    expect(e).toBeInstanceOf(Conflict);
    const hint = (e as Conflict).hint;
    expect(hint).toContain('"pack_c"');
    expect(hint).toContain('"pack_a"');
    expect(hint).toContain('ext.jan');
    expect(registry.extFields(ExtItem.name).map((d) => d.key)).toEqual(['jan', 'grade']); // `color` not added
    // the same key under another entity is fine
    expect(() => registry.registerExt(TMemo.name, { jan: f.text() }, { source: 'pack_c' })).not.toThrow();
  });

  it('AC-1 unknown entity -> DependencyError with a hint to import the defining module', () => {
    const e = caught(() => registry.registerExt('no_such_entity', { x: f.text() }, { source: 'pack_z' }));
    expect(e).toBeInstanceOf(DependencyError);
    expect((e as DependencyError).message).toContain('no_such_entity');
    expect((e as DependencyError).hint).toContain('Import the module');
  });

  it('AC-12 rejects names colliding with system/document/entity fields, bad names, non-JSONB kinds and column-only options (ValidationError)', () => {
    const cases: [string, Record<string, AnyField>, string, string][] = [
      [TPartner.name, { id: f.text() }, 'ext.id', 'system field'],
      [TPartner.name, { ext: f.text() }, 'ext.ext', 'system field'],
      [TMemo.name, { docstatus: f.int() }, 'ext.docstatus', 'system field'],
      [TPartner.name, { name: f.text() }, 'ext.name', 'already a field'],
      [TPartner.name, { 'bad-key': f.text() }, 'ext.bad-key', 'camelCase'],
      [TPartner.name, { items: { kind: 'lines', required: false, hasDefault: false, opts: {} } as unknown as AnyField }, 'ext.items', 'cannot live in JSONB'],
      [TPartner.name, { code2: f.text({ unique: true }) }, 'ext.code2', 'unique'],
      [TPartner.name, { flag: f.bool({ default: false }) }, 'ext.flag', 'default'],
    ];
    for (const [entity, fields, path, message] of cases) {
      const e = caught(() => registry.registerExt(entity, fields, { source: 'pack_bad' }));
      expect(e, path).toBeInstanceOf(ValidationError);
      expect(issuesOf(e)).toEqual([{ path, message: expect.stringContaining(message) }]);
    }
    expect(caught(() => registry.registerExt(NoExt.name, { x: f.text() }))).toBeInstanceOf(ValidationError);
    // ref is allowed (validated as uuid, no FK)
    expect(() => registry.registerExt(TPartner.name, { parentPartnerId: f.ref('test_partner') }, { source: 'pack_ok' })).not.toThrow();
    expect(registry.extFields(TPartner.name).map((d) => d.key)).toEqual(['parentPartnerId']);
  });

  it('searchable is refused on entity fields (it only means something for ext fields)', () => {
    expect(() => defineEntity({ name: 'ext_unit_bad_search', label: label('x', 'x'), fields: { name: f.text({ searchable: true }) }, permissions: { roles: { clerk: ['read'] } } })).toThrow(/views\.search/);
  });
});

describe('ext validation schema (AC-2)', () => {
  it('AC-2 registered keys are validated with the field zod; unknown keys are kept; decimals become canonical strings', () => {
    registry.registerExt(TMemoLine.name, { unitCost: f.money({ min: '0' }), lot: f.text({ normalize: 'upper' }), best: f.date(), supplierRef: f.ref('test_partner') }, { source: 'pack_lines' });
    const ok = validateExt(TMemoLine, { unitCost: '12.50', lot: 'ab-1', best: '2026-12-31', supplierRef: '01890000-0000-7000-8000-000000000000', note: { free: true } }, 'insert');
    expect(ok).toEqual({ unitCost: '12.5', lot: 'AB-1', best: '2026-12-31', supplierRef: '01890000-0000-7000-8000-000000000000', note: { free: true } });
    const bad = caught(() => validateExt(TMemoLine, { unitCost: 12.5, best: '2026-02-30', supplierRef: 'nope', lot: null }, 'insert'));
    expect(bad).toBeInstanceOf(ValidationError);
    expect(issuesOf(bad).map((i) => i.path).sort()).toEqual(['ext.best', 'ext.supplierRef', 'ext.unitCost']);
    expect(caught(() => validateExt(TMemoLine, { unitCost: '-1' }, 'update'))).toBeInstanceOf(ValidationError);
  });

  it('AC-2 required ext fields: insert without ext fails per key; update without ext leaves ext alone; entities without registrations pass through', () => {
    // ExtItem has grade (required) from the AC-1 test
    const missing = caught(() => validateExt(ExtItem, undefined, 'insert'));
    expect(issuesOf(missing)).toEqual([{ path: 'ext.grade', message: 'required' }]);
    expect(issuesOf(caught(() => validateExt(ExtItem, { jan: '490' }, 'insert')))).toEqual([{ path: 'ext.grade', message: expect.any(String) }]);
    expect(validateExt(ExtItem, undefined, 'update')).toBeUndefined();
    expect(validateExt(ExtItem, { grade: 'b' }, 'update')).toEqual({ grade: 'b' });
    expect(issuesOf(caught(() => validateExt(ExtItem, { grade: 'z' }, 'update')))[0]?.path).toBe('ext.grade');
    expect(validateExt(NoExt, undefined, 'insert')).toBeUndefined();
  });
});

describe('ext in meta and action inputs (AC-3)', () => {
  it('AC-3 EntityMeta.extFields lists ext.<key> FieldMeta (label, kind, options, required, searchable, source); [] when none', () => {
    const meta = entityMeta(ctx, ExtItem);
    expect(meta.extFields).toEqual([
      { name: 'ext.jan', kind: 'text', label: { ja: 'JAN', en: 'JAN' }, required: false, hasDefault: false, hidden: false, immutable: false, serverOwned: false, readOnly: false, searchable: true, source: 'pack_a' },
      { name: 'ext.grade', kind: 'enum', label: { ja: 'Grade', en: 'Grade' }, required: true, hasDefault: false, hidden: false, immutable: false, serverOwned: false, readOnly: false, values: ['a', 'b'], source: 'pack_b' },
    ]);
    expect(meta.fields.map((x) => x.name)).toEqual(['name', 'price', 'rate', 'qty']); // ext keys are not mixed into fields
    expect(entityMeta(ctx, NoExt).extFields).toEqual([]);
    expect(extFieldMetas(TMemoLine).map((x) => [x.name, x.kind, x.money ?? false, x.ref ?? null])).toEqual([
      ['ext.unitCost', 'decimal', true, null],
      ['ext.lot', 'text', false, null],
      ['ext.best', 'date', false, null],
      ['ext.supplierRef', 'ref', false, 'test_partner'],
    ]);
  });

  it('AC-3 generic create/update inputs (OpenAPI/MCP schemas) document registered ext keys, including ones registered after registerCrudActions', () => {
    const props = (s: z.ZodType) => z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }) as { properties?: Record<string, { properties?: Record<string, unknown>; required?: string[] }>; required?: string[] };
    const create = props(registry.action('ext_unit_item.create').input);
    expect(Object.keys(create.properties?.ext?.properties ?? {})).toEqual(['jan', 'grade']);
    expect(create.required).toEqual(['name', 'ext']); // grade is required, so ext is too
    expect(create.properties?.ext?.required).toEqual(['grade']);
    const update = props(registry.action('ext_unit_item.update').input);
    const patchExt = update.properties?.patch?.properties?.ext as { properties?: Record<string, unknown> } | undefined;
    expect(Object.keys(patchExt?.properties ?? {})).toEqual(['jan', 'grade']);
    expect(update.properties?.patch?.required).toBeUndefined(); // on update ext stays optional
    // a line entity's ext is documented inside the document's lines input
    const memo = props(registry.action('test_memo.create').input);
    const lineItems = ((memo.properties?.lines?.properties?.test_memo_line as { items?: { properties?: Record<string, { properties?: Record<string, unknown> }> } }).items?.properties ?? {}) as Record<string, { properties?: Record<string, unknown> }>;
    expect(Object.keys(lineItems.ext?.properties ?? {})).toEqual(['unitCost', 'lot', 'best', 'supplierRef']);
    // test_partner got parentPartnerId in the AC-12 test, i.e. after registerCrudActions ran
    expect(Object.keys(props(registry.action('test_partner.create').input).properties?.ext?.properties ?? {})).toEqual(['parentPartnerId']);
    // ext column but nothing registered: the free-form record as before; no ext column: no ext property
    const free = props(registry.action(`${FreeExt.name}.create`).input).properties?.ext as { properties?: unknown; additionalProperties?: unknown } | undefined;
    expect(free?.properties).toBeUndefined();
    expect(free?.additionalProperties).toBeDefined();
    expect(props(registry.action('ext_unit_plain.create').input).properties?.ext).toBeUndefined();
  });
});

describe('currency scale (AC-11)', () => {
  it('AC-11 currencyScale: JPY/KRW 0, others 2 (case/space-insensitive)', () => {
    expect([currencyScale('JPY'), currencyScale(' jpy '), currencyScale('KRW'), currencyScale('USD'), currencyScale('EUR')]).toEqual([0, 0, 0, 2, 2]);
  });

  it('AC-11 money FieldMeta carries scale from the company currency (explicit scale wins); quantities/rates are not money', () => {
    expect(fieldMeta(ExtItem, 'price', { currency: 'JPY' })).toMatchObject({ kind: 'decimal', money: true, scale: 0 });
    expect(fieldMeta(ExtItem, 'price', { currency: 'USD' })).toMatchObject({ money: true, scale: 2 });
    expect(fieldMeta(ExtItem, 'price')).toMatchObject({ money: true, scale: 6 }); // currency unknown: storage scale, as before
    expect(fieldMeta(ExtItem, 'rate', { currency: 'JPY' })).toEqual(expect.objectContaining({ scale: 4 }));
    expect(fieldMeta(ExtItem, 'rate', { currency: 'JPY' }).money).toBeUndefined();
    expect(fieldMeta(ExtItem, 'qty', { currency: 'JPY' })).toEqual(expect.objectContaining({ scale: 6 }));
    expect(fieldMeta(ExtItem, 'qty', { currency: 'JPY' }).money).toBeUndefined();
    expect(fieldMeta(TPartner, 'creditLimit', { currency: 'JPY' }).scale).toBe(0);
    expect(entityMeta(ctx, TMemo, { currency: 'KRW' }).fields.find((x) => x.name === 'amount')).toMatchObject({ money: true, scale: 0 });
  });
});
