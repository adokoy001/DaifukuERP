import { defineAction, label, repo } from '@daifuku/kernel';
import { z } from 'zod';
import { cancelInput, command, contractSnapshot, generateInput, settleInput, settlementBoard } from './contract.ts';
import { FranchiseSettlement } from './entities.ts';
import { generateFranchise, result } from './generate.ts';
import { cancelFranchise, currentInvoice, settleFranchise } from './payment.ts';
export const generateFranchiseAction = defineAction({
  name: 'franchise.generate',
  description: label('月次売上資料からFC請求・支払請求を確定', 'Generate a monthly franchise invoice once'),
  input: generateInput,
  output: command,
  permission: { entity: FranchiseSettlement.name, op: 'create' },
  handler: generateFranchise,
});
export const settleFranchiseAction = defineAction({
  name: 'franchise.settle',
  description: label('FC未決済残高の入金・支払を記録', 'Settle the outstanding franchise invoice'),
  input: settleInput,
  output: command,
  permission: { entity: FranchiseSettlement.name, op: 'update' },
  handler: settleFranchise,
});
export const cancelFranchiseAction = defineAction({
  name: 'franchise.cancel',
  description: label('FC入出金・請求を一括取消', 'Cancel franchise payment and invoice together'),
  input: cancelInput,
  output: command,
  permission: { entity: FranchiseSettlement.name, op: 'update' },
  handler: cancelFranchise,
});
export const franchiseBoardAction = defineAction({
  name: 'franchise.board',
  description: label('FC精算の根拠と現在残高', 'Franchise settlement evidence and current balance'),
  input: z.object({ settlementId: z.uuid() }),
  output: settlementBoard,
  permission: { entity: FranchiseSettlement.name, op: 'read' },
  mutates: false,
  handler: async (ctx, { settlementId }) => {
    const row = await repo(ctx, FranchiseSettlement).get(settlementId);
    const invoice = await currentInvoice(ctx, row);
    return {
      ...result(row),
      agreementId: row.agreementId,
      month: row.month,
      direction: row.direction,
      grossSales: row.grossSales.toString(),
      netSales: row.netSales.toString(),
      sourceReference: row.sourceReference,
      contract: contractSnapshot.parse(row.contract),
      fee: row.fee.toString(),
      total: row.total.toString(),
      tax: row.tax.toString(),
      date: row.date,
      dueDate: row.dueDate,
      invoiceNumber: invoice.number,
      balance: invoice.balance.toString(),
      paidAmount: invoice.paidAmount.toString(),
      cancelledDate: row.cancelledDate,
      cancelReason: row.cancelReason,
    };
  },
});
