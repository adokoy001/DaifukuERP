import { defineAction, label } from '@daifuku/kernel';
import { z } from 'zod';
import {
  billInput,
  boardInput,
  boardOutput,
  cancelBillingInput,
  cancelFulfillmentInput,
  closeInput,
  command,
  convertInput,
  detailOutput,
  fulfillInput,
} from './contract.ts';
import { TradeBilling, TradeFulfillment, TradeOrder, TradeQuotation } from './entities.ts';
import { billFulfillment, convertQuotation, fulfillOrder } from './generate.ts';
import { cancelBilling, cancelFulfillment, closeOrder } from './lifecycle.ts';
import { orderDetail, tradeBoard } from './reports.ts';
export const boardAction = defineAction({
  name: 'trade.board',
  description: label('受発注・残数の一覧', 'Trade order board'),
  input: boardInput,
  output: boardOutput,
  permission: { entity: TradeOrder.name, op: 'read' },
  mutates: false,
  handler: tradeBoard,
});
export const detailAction = defineAction({
  name: 'trade.order_detail',
  description: label('受発注の履行・請求履歴', 'Order fulfillment and billing history'),
  input: z.object({ orderId: z.uuid() }).strict(),
  output: detailOutput,
  permission: { entity: TradeOrder.name, op: 'read' },
  mutates: false,
  handler: orderDetail,
});
export const convertAction = defineAction({
  name: 'trade.convert_quotation',
  description: label('見積から受注下書き', 'Convert quotation to order draft'),
  input: convertInput,
  output: command,
  permission: { entity: TradeQuotation.name, op: 'read' },
  handler: convertQuotation,
});
export const fulfillAction = defineAction({
  name: 'trade.fulfill_order',
  description: label('分納を確定し入出庫', 'Fulfill order lines and post stock'),
  input: fulfillInput,
  output: command,
  permission: { entity: TradeFulfillment.name, op: 'create' },
  handler: fulfillOrder,
});
export const billAction = defineAction({
  name: 'trade.bill_fulfillment',
  description: label('履行数量を分割請求', 'Invoice fulfilled quantities'),
  input: billInput,
  output: command,
  permission: { entity: TradeBilling.name, op: 'create' },
  handler: billFulfillment,
});
export const cancelBillingAction = defineAction({
  name: 'trade.cancel_billing',
  description: label('商流請求と生成請求を取消', 'Cancel trade billing and invoice'),
  input: cancelBillingInput,
  output: command,
  permission: { entity: TradeBilling.name, op: 'cancel' },
  handler: cancelBilling,
});
export const cancelFulfillmentAction = defineAction({
  name: 'trade.cancel_fulfillment',
  description: label('履行と入出庫を取消', 'Cancel fulfillment and stock'),
  input: cancelFulfillmentInput,
  output: command,
  permission: { entity: TradeFulfillment.name, op: 'cancel' },
  handler: cancelFulfillment,
});
export const closeAction = defineAction({
  name: 'trade.close_order',
  description: label('注文の残数を打切り', 'Close order remainder'),
  input: closeInput,
  output: command,
  permission: { entity: TradeOrder.name, op: 'update' },
  handler: closeOrder,
});
