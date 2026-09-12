import type { ActionDef, Context, Decimal, EntityDef, FieldMap, Label, LocalDate } from '@daifuku/kernel';

export type JobDef = EntityDef<FieldMap, 'document'>;
export type ValidationStage = 'draft' | 'start' | 'complete';
export interface JobRow extends Record<string, unknown> {
  id: string; version: number; docstatus: number; number: string | null;
  reference: string | null; title: string; partnerId: string; productId: string;
  date: LocalDate; plannedDate: LocalDate | null; completedDate: LocalDate | null;
  orderedQuantity: Decimal; completedQuantity: Decimal; unitPrice: Decimal;
  quotedAmount: Decimal; completedAmount: Decimal; unitCode: string;
  taxCategory: string; status: 'queued' | 'in_progress' | 'completed' | 'cancelled';
  completionNote: string | null; salesInvoiceId: string | null; cancelledDate: LocalDate | null;
}
export interface IndustryJobConfig {
  name: string; label: Label; quantityLabel: Label; unitCode: string;
  productKind: 'goods' | 'service'; fields: FieldMap; form: readonly (readonly string[])[];
  dueDays: number;
  validate: (row: Record<string, unknown>, stage: ValidationStage) => void;
}
export interface JobEngine {
  Job: JobDef; actions: readonly ActionDef[]; registerHooks: () => void;
}
export type OwnedWrite = <T>(ctx: Context, work: (owned: Context) => Promise<T>) => Promise<T>;
