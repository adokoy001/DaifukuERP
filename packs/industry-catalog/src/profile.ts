import { f, label, type FieldDef } from '@daifuku/kernel';
import { amount, invalid, integerQuantity, requiredText, type IndustryJobConfig, type ValidationStage } from '@daifuku/mod-industry-operations';
export interface IndustryProfile {
  job: IndustryJobConfig;
  productName: string;
  unitName: string;
  unitPrice: string;
  orderedQuantity: string;
  sample: (date: string) => Record<string, unknown>;
}
export const textField = (ja: string, en: string, required = false): FieldDef => f.text({ label: label(ja, en), required, maxLength: 300 });
export const intField = (ja: string, en: string, min = 0, fallback = 0): FieldDef => f.int({ label: label(ja, en), required: true, default: fallback, min });
export function wholeUnits(row: Record<string, unknown>): void {
  integerQuantity(row, 'orderedQuantity'); integerQuantity(row, 'completedQuantity');
}
export function needs(row: Record<string, unknown>, stage: ValidationStage, initial: string[], completed: string[] = []): void {
  if (stage !== 'draft') for (const key of initial) requiredText(row, key);
  if (stage === 'complete') for (const key of completed) requiredText(row, key);
}
export function oneJob(row: Record<string, unknown>, stage: ValidationStage): void {
  if (!amount(row.orderedQuantity, 'orderedQuantity').eq('1')) invalid('orderedQuantity', 'この案件は一式単位で受注します。');
  if (stage === 'complete' && !amount(row.completedQuantity, 'completedQuantity').eq('1')) invalid('completedQuantity', '一式の履行が完了してから確定してください。');
}
