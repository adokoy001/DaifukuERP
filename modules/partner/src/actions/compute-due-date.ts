// partner.compute_due_date (spec AC-10): due date from the partner's payment terms.
import { defineAction, isLocalDate, label, repo } from '@daifuku/kernel';
import { z } from 'zod';
import { Partner } from '../entities/partner.ts';
import { resolveDueDate } from '../services/due-date.ts';

const localDate = z.string().refine(isLocalDate, 'must be YYYY-MM-DD');

export const computeDueDateAction = defineAction({
  name: 'partner.compute_due_date',
  description: label(
    '取引先の締め日・支払月・支払日から、請求日に対する支払期日を計算します。31 は月末。請求日が締め日より後なら翌月の締め期間に属します。',
    "Compute the payment due date for an invoice date from the partner's closing day / payment month offset / payment day. 31 means end of month; an invoice after the closing day belongs to the next period.",
  ),
  input: z.object({ partnerId: z.uuid(), invoiceDate: localDate }),
  output: z.object({ partnerId: z.uuid(), invoiceDate: localDate, closingDate: localDate, dueDate: localDate }),
  permission: { entity: 'partner', op: 'read' },
  tx: 'none',
  mutates: false,
  handler: async (ctx, { partnerId, invoiceDate }) => {
    const p = await repo(ctx, Partner).get(partnerId);
    const { closingDate, dueDate } = resolveDueDate(invoiceDate, { closingDay: p.closingDay, paymentMonthOffset: p.paymentMonthOffset, paymentDay: p.paymentDay });
    return { partnerId, invoiceDate, closingDate, dueDate };
  },
});
