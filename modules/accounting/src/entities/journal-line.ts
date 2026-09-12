// Journal line (仕訳明細, spec AC-3). Ordinary entity declared as a line of journal_entry; the kernel gives it
// replace-all save and the draft-only rule; hooks/freeze-lines.ts extends the freeze to direct line writes.
// `entryDate` / `posted` are denormalised from the header at submit so the aggregate port (single entity, no
// joins) can compute trial balances and ledgers without raw SQL (AC-8, AC-9).
import { defineEntity, f, label } from '@daifuku/kernel';
import { ACCOUNT_TYPES, TAX_ROLES, TAX_CATEGORIES, TAX_CATEGORY_LABELS } from './account.ts';

export const JournalLine = defineEntity({
  name: 'journal_line',
  label: label('仕訳明細', 'Journal line'),
  fields: {
    accountType: f.enum(ACCOUNT_TYPES, { label: label('転記時勘定区分', 'Account type at posting'), serverOwned: true, hidden: true }),
    accountTaxRole: f.enum(TAX_ROLES, { label: label('転記時税分類', 'Account tax role at posting'), serverOwned: true, hidden: true }),
    entryId: f.ref('journal_entry', { label: label('仕訳', 'Journal entry'), required: true, onDelete: 'cascade' }),
    seq: f.int({ label: label('行番号', 'Seq'), required: true, default: 1, min: 1 }),
    accountId: f.ref('account', { label: label('勘定科目', 'Account'), required: true }),
    debit: f.money({ label: label('借方', 'Debit'), required: true, default: '0', min: '0' }),
    credit: f.money({ label: label('貸方', 'Credit'), required: true, default: '0', min: '0' }),
    partnerId: f.ref('partner', { label: label('取引先', 'Partner') }),
    taxCategory: f.enum(TAX_CATEGORIES, { label: label('税区分', 'Tax category'), labels: TAX_CATEGORY_LABELS }),
    taxRate: f.decimal({ label: label('税率', 'Tax rate'), description: label('例: 0.10', 'e.g. 0.10'), scale: 4, min: '0' }),
    memo: f.text({ label: label('メモ', 'Memo'), maxLength: 200 }),
    entryDate: f.date({ serverOwned: true, label: label('仕訳日付', 'Entry date'), description: label('submit 時にヘッダから複写', 'copied from the header at submit'), hidden: true }),
    posted: f.bool({ serverOwned: true, label: label('転記済み', 'Posted'), description: label('submit 時に true', 'set at submit'), required: true, default: false, hidden: true }),
  },
  audit: 'none',
  indexes: [['accountId', 'posted', 'entryDate']],
  permissions: {
    roles: {
      accounting: ['read', 'create', 'update', 'delete'],
      // update is needed by the submit hook that stamps entryDate/posted in the submitting user's context.
      sales: ['read', 'create', 'update'],
      purchasing: ['read', 'create', 'update'],
      viewer: ['read'],
    },
  },
  views: { list: ['seq', 'accountId', 'debit', 'credit', 'partnerId', 'taxCategory', 'memo'] },
});

export type JournalLineDef = typeof JournalLine;
