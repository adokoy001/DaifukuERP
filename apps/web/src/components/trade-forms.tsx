import { useState } from 'react';
import { billInput, command as tradeCommand, convertInput, fulfillInput, type TradeOrderDetail } from '@daifuku/mod-trade/contract';
import { useFinanceCommand } from '../api/finance.ts';
import type { RecordJson } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { compareDecimalStrings } from '../lib/decimal.ts';
import { FinanceDialog, FinanceField, FinanceNotice, FinanceRef } from './finance-shared.tsx';

type Fulfillment = TradeOrderDetail['fulfillments'][number];
export type TradeSelection = { type: 'fulfill' | 'close'; detail: TradeOrderDetail } | { type: 'bill' | 'cancel-fulfillment'; detail: TradeOrderDetail; fulfillment: Fulfillment } | { type: 'cancel-billing'; billing: Fulfillment['billings'][number] } | { type: 'convert'; quotation: RecordJson };

export function TradeQuantityForm({ selection, stale, onClose }: { selection: Extract<TradeSelection, { type: 'fulfill' | 'close' }> | Extract<TradeSelection, { type: 'bill' | 'cancel-fulfillment' }>; stale: boolean; onClose: () => void }) {
  const { t } = useLocale(), [warehouseId, setWarehouseId] = useState(''), [requestId] = useState(() => crypto.randomUUID()), command = useFinanceCommand();
  const billing = selection.type === 'bill', order = selection.detail.order, sales = order.direction === 'sales';
  const lines = billing && 'fulfillment' in selection ? selection.fulfillment.lines.filter((line) => compareDecimalStrings(line.unbilledQuantity, '0') === 1).map((line) => ({ ...line, available: line.unbilledQuantity })) : selection.detail.lines.filter((line) => compareDecimalStrings(line.remainingQuantity, '0') === 1).map((line) => ({ ...line, available: line.remainingQuantity }));
  return <FinanceDialog title={t(billing ? { ja: '履行済み数量から請求を作成', en: 'Invoice fulfilled quantities' } : sales ? { ja: '受注から出荷', en: 'Ship sales order' } : { ja: '発注から入荷', en: 'Receive purchase order' })} description={`${order.number} · ${order.partner}`} submitLabel={t(billing ? { ja: '数量を確認して請求を確定', en: 'Confirm quantities and invoice' } : { ja: '数量を確認して入出庫', en: 'Confirm stock movement' })} stale={stale} onClose={onClose} onSubmit={async (data) => {
    const chosen = lines.flatMap((line) => { const quantity = String(data.get(`quantity:${line.id}`) ?? '').trim(); if (!quantity || compareDecimalStrings(quantity, '0') === 0) return []; if (compareDecimalStrings(quantity, '0') !== 1 || compareDecimalStrings(quantity, line.available) === 1) throw new Error(t({ ja: '数量は残数以下の正数を入力してください。', en: 'Enter positive quantities within the remaining balance.' })); return [billing ? { fulfillmentLineId: line.id, quantity } : { orderLineId: line.id, quantity }]; });
    const date = String(data.get('date') ?? '');
    const input = billing && 'fulfillment' in selection ? billInput.parse({ fulfillmentId: selection.fulfillment.id, expectedVersion: selection.fulfillment.version, date, ...(data.get('dueDate') ? { dueDate: String(data.get('dueDate')) } : {}), ...(data.get('supplierInvoiceNo') ? { supplierInvoiceNo: String(data.get('supplierInvoiceNo')) } : {}), lines: chosen, requestId }) : fulfillInput.parse({ orderId: order.id, expectedVersion: order.version, date, warehouseId, lines: chosen, requestId });
    await command.mutateAsync({ action: billing ? 'trade.bill_fulfillment' : 'trade.fulfill_order', input });
  }}>
    <FinanceNotice>{t(billing ? { ja: '請求書を確定し会計へ転記します。この履行で入出庫した在庫を、請求で再び動かすことはありません。', en: 'Submit the invoice and post accounting entries. Stock already moved by this fulfillment is not moved again.' } : { ja: '今回処理する数量を入力してください。空欄・0は対象外です。処理後は残数が更新され、分納・分割請求へ引き継がれます。', en: 'Enter quantities for this movement. Blank or zero means not included. Remaining quantities carry forward to later fulfillment and billing.' })}</FinanceNotice>
    <div className="finance-form-grid"><FinanceField label={billing ? { ja: '請求日', en: 'Invoice date' } : { ja: '入出庫日', en: 'Movement date' }} name="date" type="date" required/>{billing ? <FinanceField label={{ ja: '支払期日', en: 'Due date' }} name="dueDate" type="date"/> : <FinanceRef label={{ ja: '倉庫', en: 'Warehouse' }} name="warehouseId" entity="warehouse" value={warehouseId} onChange={setWarehouseId}/>} {billing && !sales ? <FinanceField label={{ ja: '仕入先請求番号', en: 'Supplier invoice number' }} name="supplierInvoiceNo" maxLength={50}/> : null}</div>
    <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>{t({ ja: '品目・単位', en: 'Item / unit' })}</th><th>{t({ ja: '処理可能な残数', en: 'Available quantity' })}</th><th>{t({ ja: '今回の数量', en: 'Quantity now' })}</th></tr></thead><tbody>{lines.map((line) => <tr key={line.id}><td>{line.description}<small>{line.uomCode}</small></td><td>{line.available}</td><td><input className="input" aria-label={`${line.description} ${t({ ja: '今回の数量', en: 'Quantity now' })}`} name={`quantity:${line.id}`} inputMode="decimal" defaultValue={line.available}/></td></tr>)}</tbody></table></div>
  </FinanceDialog>;
}

export function TradeConvertForm({ row, stale, onCreated, onClose }: { row: RecordJson; stale: boolean; onCreated: (id: string) => void; onClose: () => void }) {
  const { t } = useLocale(), command = useFinanceCommand();
  return <FinanceDialog title={t({ ja: '見積から受注を作成', en: 'Create order from quotation' })} description={String(row.number)} submitLabel={t({ ja: '見積内容を引き継いで受注作成', en: 'Create order from quotation' })} stale={stale} onClose={onClose} onSubmit={async (data) => {
    const input = convertInput.parse({ quotationId: row.id, expectedVersion: row.version, date: String(data.get('date') ?? ''), ...(data.get('requiredDate') ? { requiredDate: String(data.get('requiredDate')) } : {}) });
    const result = tradeCommand.parse(await command.mutateAsync({ action: 'trade.convert_quotation', input })); onCreated(result.id);
  }}><FinanceField label={{ ja: '受注日', en: 'Order date' }} name="date" type="date" required/><FinanceField label={{ ja: '希望納期', en: 'Required date' }} name="requiredDate" type="date"/></FinanceDialog>;
}

export function TradeCancelForm({ selection, stale, onClose }: { selection: TradeSelection; stale: boolean; onClose: () => void }) {
  const { t } = useLocale(), command = useFinanceCommand(), closing = selection.type === 'close';
  return <FinanceDialog title={t(closing ? { ja: '注文の残数を終了', en: 'Close remaining order quantities' } : { ja: '商流の処理を取消', en: 'Cancel trade processing' })} submitLabel={t({ ja: '理由を記録して実行', en: 'Record reason and proceed' })} stale={stale} onClose={onClose} onSubmit={async (data) => {
    const reason = String(data.get('reason') ?? ''), correctionDate = String(data.get('correctionDate') ?? '');
    if (selection.type === 'close') await command.mutateAsync({ action: 'trade.close_order', input: { orderId: selection.detail.order.id, expectedVersion: selection.detail.order.version, reason } });
    else if (selection.type === 'cancel-billing') await command.mutateAsync({ action: 'trade.cancel_billing', input: { billingId: selection.billing.id, expectedVersion: selection.billing.version, correctionDate, reason } });
    else if (selection.type === 'cancel-fulfillment') await command.mutateAsync({ action: 'trade.cancel_fulfillment', input: { fulfillmentId: selection.fulfillment.id, expectedVersion: selection.fulfillment.version, correctionDate, reason } });
  }}><FinanceNotice>{t(closing ? { ja: '既存の履行や請求を残し、今後の残数処理を終了します。すでに履行した数量の未請求分は、終了後も請求できます。', en: 'Keep existing fulfillment and billing while closing the remaining quantities. You can still bill quantities already fulfilled.' } : { ja: '後続の請求・入出金がある場合は先に整合する順序で取り消してください。元の履歴を保持し、必要な反対処理を行います。', en: 'Resolve downstream invoices and payments in order first. History is retained and required reversals are posted.' })}</FinanceNotice>{!closing ? <FinanceField label={{ ja: '訂正日', en: 'Correction date' }} name="correctionDate" type="date" required/> : null}<FinanceField label={{ ja: '理由', en: 'Reason' }} name="reason" required maxLength={1000}/></FinanceDialog>;
}
