// Attachment (証憑) entity (docs/specs/attachments.md AC-1). Stores the metadata the 電子帳簿保存法 search
// requirement needs (取引年月日・取引金額・取引先, docs/domain/japan-tax.md#電子帳簿保存法); the bytes live behind the
// kernel storage port. Rows are superseded, never deleted (hooks/integrity.ts).
import '@daifuku/mod-partner'; // registers `partner`, the target of `partnerId`
import { defineEntity, f, label, snapshot, type Infer } from '@daifuku/kernel';

export const ATTACHMENT_KINDS = ['invoice_received', 'invoice_issued', 'receipt', 'contract', 'bank_statement', 'other'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const Attachment = defineEntity({
  name: 'attachment',
  label: label('証憑', 'Attachment'),
  fields: {
    storageKey: f.text({ serverOwned: true, label: label('ストレージキー', 'Storage key'), required: true, immutable: true, hidden: true, maxLength: 200 }),
    filename: f.text({ serverOwned: true, label: label('ファイル名', 'Filename'), required: true, maxLength: 255 }),
    contentType: f.text({ serverOwned: true, label: label('コンテンツタイプ', 'Content type'), required: true, maxLength: 100 }),
    size: f.int({ serverOwned: true, label: label('サイズ（バイト）', 'Size (bytes)'), required: true, min: 0 }),
    sha256: f.text({ serverOwned: true, label: label('SHA-256', 'SHA-256'), required: true, immutable: true, unique: true, pattern: /^[0-9a-f]{64}$/ }),
    kind: f.enum(ATTACHMENT_KINDS, {
      label: label('種別', 'Kind'),
      required: true,
      default: 'other',
      labels: {
        invoice_received: label('受領請求書', 'Invoice (received)'),
        invoice_issued: label('発行請求書', 'Invoice (issued)'),
        receipt: label('領収書', 'Receipt'),
        contract: label('契約書', 'Contract'),
        bank_statement: label('銀行明細', 'Bank statement'),
        other: label('その他', 'Other'),
      },
    }),
    txnDate: f.date({ label: label('取引年月日', 'Transaction date'), index: true }),
    amount: f.money({ label: label('取引金額', 'Amount'), index: true }),
    partnerId: f.ref('partner', { label: label('取引先', 'Partner') }),
    linkedEntity: f.text({ label: label('リンク先エンティティ', 'Linked entity'), maxLength: 100 }),
    linkedId: f.uuid({ label: label('リンク先レコード', 'Linked record') }),
    note: f.text({ label: label('備考', 'Note'), multiline: true }),
    supersededById: f.ref('attachment', { serverOwned: true, label: label('差替先', 'Superseded by') }),
  },
  permissions: {
    // 電帳法: no role is granted `delete`; evidence is superseded (attachment.supersede), never removed.
    roles: {
      accounting: ['read', 'create', 'update'],
      sales: ['read', 'create', 'update'],
      purchasing: ['read', 'create', 'update'],
      viewer: ['read'],
    },
  },
  displayField: 'filename',
  indexes: [['linkedEntity', 'linkedId']],
  views: {
    list: ['filename', 'kind', 'txnDate', 'amount', 'partnerId', 'supersededById'],
    search: ['filename', 'note'],
    form: [
      ['filename', 'kind', 'contentType', 'size', 'sha256'],
      ['txnDate', 'amount', 'partnerId'],
      ['linkedEntity', 'linkedId'],
      ['note', 'supersededById'],
    ],
  },
});

export type AttachmentDef = typeof Attachment;

/** JSON-safe row for action outputs (Decimal -> string, Date -> ISO), matching `Attachment.schemas.json`. */
export function attachmentJson(row: Infer<typeof Attachment>): Record<string, unknown> {
  return snapshot({ ...row });
}
