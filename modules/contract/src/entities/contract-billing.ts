// Billing ledger (spec AC-4): one row per (contract, period) that has an invoice. The unique constraint is the
// idempotency guarantee — a second generation for the same period finds the row, and two concurrent runs cannot both
// insert it (the loser's transaction, invoice included, rolls back). Rows are written only inside
// contract.generate_invoices (hooks/billing.ts), so sales holds read/create and nobody holds update/delete.
// Deleting a draft generated invoice removes its row (cascade), which makes the period due again.
import { defineEntity, f, label } from '@daifuku/kernel';
import { PERIOD_PATTERN } from '../services/periods.ts';

export const ContractBilling = defineEntity({
  name: 'contract_billing',
  label: label('契約請求履歴', 'Contract billing record'),
  fields: {
    contractId: f.ref('contract', { serverOwned: true, label: label('契約', 'Contract'), required: true, immutable: true }),
    period: f.text({ serverOwned: true, label: label('対象月', 'Period'), description: label('YYYY-MM（請求間隔が複数月なら先頭月）', 'YYYY-MM (first month when the interval spans several months)'), required: true, immutable: true, pattern: PERIOD_PATTERN, maxLength: 7 }),
    invoiceId: f.ref('sales_invoice', { serverOwned: true, label: label('売上請求書', 'Sales invoice'), required: true, onDelete: 'cascade' }),
  },
  unique: [['contractId', 'period']],
  indexes: [['period']],
  permissions: {
    roles: {
      sales: ['read', 'create'],
      accounting: ['read'],
      viewer: ['read'],
    },
  },
  views: { list: ['contractId', 'period', 'invoiceId'] },
});

export type ContractBillingDef = typeof ContractBilling;
