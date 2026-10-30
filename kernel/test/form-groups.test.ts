// docs/specs/form-ergonomics.md AC-1 (ADR-0002 addendum): labelled `views.form` groups — definition-time checks and
// the /meta shape (plain groups stay string[], labelled groups become { label, fields }), and AC-8's `restricted` flag.
import { describe, expect, it } from 'vitest';
import type { Context, Db } from '../src/context.ts';
import { makeContext } from '../src/db/client.ts';
import { defineEntity } from '../src/dsl/entity.ts';
import { f } from '../src/dsl/fields.ts';
import { label } from '../src/i18n.ts';
import { entityMeta } from '../src/meta.ts';

const admin: Context = makeContext({} as unknown as Db, {
  tenantId: '00000000-0000-0000-0000-000000000001',
  companyId: null,
  actor: { type: 'user', id: 'u' },
  roles: ['admin'],
});
const clerk: Context = makeContext({} as unknown as Db, {
  tenantId: '00000000-0000-0000-0000-000000000001',
  companyId: null,
  actor: { type: 'user', id: 'c' },
  roles: ['clerk'],
});

const Grouped = defineEntity({
  name: 'fg_grouped',
  label: label('グループ', 'Grouped'),
  fields: {
    code: f.text({ required: true }),
    name: f.text({ required: true }),
    phone: f.text(),
    bankAccountNo: f.text(),
    notes: f.text({ multiline: true }),
  },
  permissions: {
    roles: { admin: ['read', 'create', 'update'], clerk: ['read', 'update'] },
    fieldGroups: { bank: { fields: ['bankAccountNo'], roles: ['admin'] } },
  },
  views: {
    form: [
      { label: label('基本', 'Basics'), fields: ['code', 'name'] },
      ['phone'],
      { label: label('口座', 'Bank account'), fields: ['bankAccountNo'] },
      { label: label('備考', 'Notes'), fields: ['notes'] },
    ],
  },
});

const base = {
  label: label('x', 'x'),
  fields: { a: f.text(), b: f.text() },
  permissions: { roles: { admin: ['read' as const] } },
};

describe('views.form labelled groups (form-ergonomics AC-1)', () => {
  it('AC-1 /meta keeps plain groups as string[] and emits labelled groups as { label, fields }', () => {
    expect(entityMeta(admin, Grouped).views.form).toEqual([
      { label: { ja: '基本', en: 'Basics' }, fields: ['code', 'name'] },
      ['phone'],
      { label: { ja: '口座', en: 'Bank account' }, fields: ['bankAccountNo'] },
      { label: { ja: '備考', en: 'Notes' }, fields: ['notes'] },
    ]);
  });

  it('AC-1 a labelled group whose fields are all masked becomes a plain [] (no label of the hidden section)', () => {
    const form = entityMeta(clerk, Grouped).views.form;
    expect(form).toEqual([
      { label: { ja: '基本', en: 'Basics' }, fields: ['code', 'name'] },
      ['phone'],
      [],
      { label: { ja: '備考', en: 'Notes' }, fields: ['notes'] },
    ]);
    expect(JSON.stringify(form)).not.toContain('bankAccountNo');
    expect(JSON.stringify(form)).not.toContain('口座');
    expect(JSON.stringify(form)).not.toContain('Bank account');
  });

  it('AC-1 the original string[][] form is accepted and emitted unchanged', () => {
    const Plain = defineEntity({ ...base, name: 'fg_plain', views: { form: [['b'], ['a']] } });
    expect(entityMeta(admin, Plain).views.form).toEqual([['b'], ['a']]);
    const Auto = defineEntity({ ...base, name: 'fg_auto', views: { form: 'auto' } });
    expect(entityMeta(admin, Auto).views.form).toBe('auto');
  });

  it('AC-1 rejects unknown or repeated fields, a label without ja/en text and an empty labelled group', () => {
    expect(() => defineEntity({ ...base, name: 'fg_unknown', views: { form: [['a', 'nope']] } })).toThrow(
      /views\.form references unknown field "nope"/,
    );
    expect(() =>
      defineEntity({
        ...base,
        name: 'fg_unknown_labelled',
        views: { form: [{ label: label('x', 'x'), fields: ['nope'] }] },
      }),
    ).toThrow(/views\.form references unknown field "nope"/);
    expect(() =>
      defineEntity({ ...base, name: 'fg_twice', views: { form: [['a'], { label: label('x', 'x'), fields: ['a'] }] } }),
    ).toThrow(/lists field "a" more than once/);
    expect(() =>
      defineEntity({ ...base, name: 'fg_label', views: { form: [{ label: { ja: '基本', en: ' ' }, fields: ['a'] }] } }),
    ).toThrow(/group 1 needs a label with ja and en text/);
    expect(() =>
      defineEntity({ ...base, name: 'fg_empty', views: { form: [['a'], { label: label('x', 'x'), fields: [] }] } }),
    ).toThrow(/group 2 lists no fields/);
  });
});

describe('restricted fields in /meta (form-ergonomics AC-8)', () => {
  it('AC-8 a field listed in a permission field group is marked restricted for the roles that may see it', () => {
    const fields = entityMeta(admin, Grouped).fields;
    expect(fields.find((x) => x.name === 'bankAccountNo')?.restricted).toBe(true);
    expect(fields.find((x) => x.name === 'phone')?.restricted).toBeUndefined();
    expect(entityMeta(clerk, Grouped).fields.some((x) => x.name === 'bankAccountNo')).toBe(false);
  });
});
