// docs/specs/recurring-journals.md AC-1 (ADR-0031): an entity (not only a document) may declare `lines`. The generic
// create/update inputs and the get output carry them, /meta reports them, and a parentField that is not a ref back to
// the parent fails at definition time (when the line specs are first resolved).
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createInputSchema, hasLines, recordJsonSchema, updateInputSchema } from '../src/actions/crud-schemas.ts';
import type { Context, Db } from '../src/context.ts';
import { makeContext } from '../src/db/client.ts';
import { defineEntity } from '../src/dsl/entity.ts';
import { f } from '../src/dsl/fields.ts';
import { label } from '../src/i18n.ts';
import { isImportable } from '../src/import-values.ts';
import { lineSpecs } from '../src/lines.ts';
import { entityMeta } from '../src/meta.ts';
import { TMemo, TPartner } from './fixtures/entities.ts';

const Book = defineEntity({
  name: 'elu_book',
  label: label('明細つきマスタ', 'Master with lines'),
  fields: { name: f.text({ required: true }) },
  lines: [{ entity: 'elu_book_line', parentField: 'bookId' }],
  permissions: { roles: { clerk: ['read', 'create', 'update'] } },
});
const BookLine = defineEntity({
  name: 'elu_book_line',
  label: label('マスタ明細', 'Master line'),
  fields: {
    bookId: f.ref('elu_book', { required: true, onDelete: 'cascade' }),
    seq: f.int({ required: true, default: 1 }),
    note: f.text({ required: true }),
  },
  permissions: { roles: { clerk: ['read', 'create', 'update', 'delete'] } },
});
const Broken = defineEntity({
  name: 'elu_broken',
  label: label('壊れた明細', 'Broken lines'),
  fields: { name: f.text() },
  lines: [{ entity: 'elu_broken_line', parentField: 'ownerId' }],
  permissions: { roles: { clerk: ['read'] } },
});
defineEntity({
  name: 'elu_broken_line',
  label: label('壊れた明細行', 'Broken line'),
  // a ref, but to another entity: not a line of elu_broken
  fields: { ownerId: f.ref('elu_book', { required: true }) },
  permissions: { roles: { clerk: ['read'] } },
});

const ctx: Context = makeContext({} as unknown as Db, {
  tenantId: '00000000-0000-0000-0000-000000000001',
  companyId: null,
  actor: { type: 'user', id: 'u' },
  roles: ['admin'],
});

describe('entity lines (recurring-journals AC-1, ADR-0031)', () => {
  it('AC-1 an entity with lines has line specs and hasLines; an entity without them does not', () => {
    expect(Book.kind).toBe('entity');
    expect(hasLines(Book)).toBe(true);
    expect(lineSpecs(Book).map((s) => [s.entity.name, s.parentField])).toEqual([['elu_book_line', 'bookId']]);
    expect(hasLines(TPartner)).toBe(false);
    expect(hasLines(TMemo)).toBe(true); // documents keep working
  });

  it('AC-1 generic create/update inputs accept lines (without the parent ref) and the record output includes them', () => {
    const create = createInputSchema(Book) as z.ZodObject<Record<string, z.ZodType>>;
    expect(Object.keys(create.shape)).toContain('lines');
    const parsed = create.safeParse({ name: 'n', lines: { elu_book_line: [{ note: 'a' }, { note: 'b', seq: 2 }] } });
    expect(parsed.success).toBe(true);
    const update = updateInputSchema(Book);
    expect(
      update.safeParse({
        id: '00000000-0000-4000-8000-000000000001',
        patch: { lines: { elu_book_line: [{ note: 'a' }] } },
      }).success,
    ).toBe(true);
    const output = recordJsonSchema(Book) as z.ZodObject<Record<string, z.ZodType>>;
    expect(Object.keys(output.shape)).toContain('lines');
    expect(Object.keys((recordJsonSchema(TPartner) as z.ZodObject<Record<string, z.ZodType>>).shape)).not.toContain(
      'lines',
    );
  });

  it('AC-1 EntityMeta.lines is reported for an entity parent; an entity without lines has none', () => {
    expect(entityMeta(ctx, Book).lines).toEqual([{ entity: 'elu_book_line', parentField: 'bookId' }]);
    expect(entityMeta(ctx, TPartner).lines).toBeUndefined();
    expect(entityMeta(ctx, TMemo).lines).toEqual([{ entity: 'test_memo_line', parentField: 'memoId' }]);
  });

  it('AC-1 a parentField that is not a ref back to the parent is an Error naming the entity', () => {
    expect(() => lineSpecs(Broken)).toThrow(/entity elu_broken: line entity elu_broken_line.ownerId must be a ref/);
  });

  it('AC-1 line entities of an entity are not CSV-importable on their own (B5); the parent still is', () => {
    expect(isImportable(BookLine)).toBe(false);
    expect(isImportable(Book)).toBe(true);
  });
});
