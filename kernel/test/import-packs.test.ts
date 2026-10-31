// csv-import (docs/specs/csv-import.md) AC-2/AC-9/AC-10 with a pack: headers may use the pack's label overrides (only
// for companies that applied it), and its ext fields, named by key or label, are ignored columns rather than unknown
// ones. A file of its own because a pack's label overrides also become the global labels of the process.
import { describe, expect, it } from 'vitest';
import { definePack } from '../src/dsl/pack.ts';
import { f } from '../src/dsl/fields.ts';
import { label } from '../src/i18n.ts';
import { resolveHeader, templateHeaders } from '../src/import-values.ts';
import { ImpItem } from './fixtures/import-entities.ts';

const PACK = 'test_imp_labels';
definePack({
  name: PACK,
  label: label('テスト取込ラベル', 'Test import labels'),
  depends: [],
  labels: { test_imp_item: { fields: { name: label('商品名', 'Product name') } } },
  ext: { test_imp_item: { jan: f.text({ label: label('JANコード', 'JAN code') }) } },
});

describe('AC-2/AC-10: pack label overrides', () => {
  it('AC-2: a header may use the label the applied pack gives a field; without the pack it is unknown', () => {
    expect(resolveHeader(ImpItem, '商品名', [PACK])).toEqual({ kind: 'field', field: 'name' });
    expect(resolveHeader(ImpItem, 'product name', [PACK])).toEqual({ kind: 'field', field: 'name' });
    expect(resolveHeader(ImpItem, '商品名', [])).toEqual({ kind: 'unknown' });
    expect(resolveHeader(ImpItem, '名称', [])).toEqual({ kind: 'field', field: 'name' });
    // The field name always resolves.
    expect(resolveHeader(ImpItem, 'name', [PACK])).toEqual({ kind: 'field', field: 'name' });
  });

  it('AC-10: the template uses the label of the applied pack', () => {
    expect(templateHeaders(ImpItem, 'ja', new Set(), [PACK]).slice(0, 2)).toEqual(['品目コード', '商品名']);
    expect(templateHeaders(ImpItem, 'en', new Set(), [PACK]).slice(0, 2)).toEqual(['Item code', 'Product name']);
    expect(templateHeaders(ImpItem, 'ja', new Set(), []).slice(0, 2)).toEqual(['品目コード', '名称']);
  });
});

describe('AC-9: ext columns are ignored however they are named', () => {
  it('AC-9: `ext.<key>`, the bare key and the ja/en label of a visible ext field are ignored with reason ext', () => {
    for (const header of ['ext.jan', 'jan', 'JANコード', 'ｊａｎ ｃｏｄｅ'])
      expect(resolveHeader(ImpItem, header, [PACK]), header).toEqual({ kind: 'ignored', reason: 'ext' });
  });

  it("AC-9: an ext field of a pack the company has not applied is not the caller's: its label is an unknown column", () => {
    expect(resolveHeader(ImpItem, 'JANコード', [])).toEqual({ kind: 'unknown' });
    expect(resolveHeader(ImpItem, 'jan', [])).toEqual({ kind: 'unknown' });
    // `ext.` columns are never fields of the entity itself, so they stay ignored.
    expect(resolveHeader(ImpItem, 'ext.jan', [])).toEqual({ kind: 'ignored', reason: 'ext' });
  });
});
