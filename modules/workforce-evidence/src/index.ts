import { defineModule, label } from '@daifuku/kernel';
import { WorkforceReceipt } from './receipt.ts';
import { receiptHooks } from './service.ts';
export const WorkforceEvidenceModule = defineModule({ name: 'workforce_evidence', label: label('従業員証憑', 'Employee evidence'), depends: ['workforce', 'attachment'], entities: [WorkforceReceipt], hooks: receiptHooks });
export { WorkforceReceipt, receiptInfo, type ReceiptInfo } from './receipt.ts';
export { uploadReceipt, listReceipts, downloadReceipt } from './service.ts';
export { MAX_RECEIPT_BYTES, validateReceipt, type ReceiptUpload } from './validation.ts';
