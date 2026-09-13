// Journal entry header (仕訳, spec AC-3..AC-7, ADR-0005). Submitted entries are immutable: no cancel (hook), lines
// frozen (kernel + hook), only `description` editable. Corrections are reversals (accounting.reverse_entry).
import { defineDocument, f, label } from '@daifuku/kernel';

export const JournalEntry = defineDocument({
  name: 'journal_entry',
  label: label('仕訳', 'Journal entry'),
  naming: { type: 'sequence', prefix: 'JE-', period: 'year' },
  fields: {
    date: f.date({ label: label('日付', 'Date'), required: true, index: true }),
    description: f.text({ label: label('摘要', 'Description'), maxLength: 500 }),
    sourceEntity: f.text({
      serverOwned: true,
      label: label('起票元エンティティ', 'Source entity'),
      description: label('例: sales_invoice', 'e.g. sales_invoice'),
      maxLength: 100,
    }),
    sourceId: f.uuid({ serverOwned: true, label: label('起票元 ID', 'Source id') }),
    reversalOf: f.ref('journal_entry', { serverOwned: true, label: label('逆仕訳元', 'Reversal of') }),
    totalDebit: f.money({
      serverOwned: true,
      label: label('借方合計', 'Total debit'),
      description: label('submit 時に明細から算出', 'computed from the lines at submit'),
      required: true,
      default: '0',
    }),
    totalCredit: f.money({
      serverOwned: true,
      label: label('貸方合計', 'Total credit'),
      description: label('submit 時に明細から算出', 'computed from the lines at submit'),
      required: true,
      default: '0',
    }),
  },
  displayField: 'description',
  allowOnSubmit: ['description'],
  lines: [{ entity: 'journal_line', parentField: 'entryId' }],
  indexes: [['sourceEntity', 'sourceId']],
  permissions: {
    roles: {
      accounting: ['read', 'create', 'update', 'delete', 'submit'],
      // sales/purchase/payment post through accounting.post_from_source in the calling user's context (ADR-0007: no
      // bypass), so their roles need create/update(lines)/submit. Manual posting by these roles is a known trade-off.
      sales: ['read', 'create', 'update', 'submit'],
      purchasing: ['read', 'create', 'update', 'submit'],
      viewer: ['read'],
    },
  },
  views: {
    list: ['date', 'description', 'totalDebit', 'totalCredit', 'sourceEntity'],
    search: ['description'],
    form: [
      ['date', 'description'],
      ['sourceEntity', 'sourceId', 'reversalOf'],
      ['totalDebit', 'totalCredit'],
    ],
  },
});

export type JournalEntryDef = typeof JournalEntry;
