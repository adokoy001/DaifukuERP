import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { boardOutput, detailOutput, type TradeOrderDetail } from '@daifuku/mod-trade/contract';
import { financeIdentity, useFinanceAccess, useFinanceList, useFinanceRead } from '../api/finance.ts';
import { useLocale } from '../i18n.tsx';
import {
  FinanceEmpty,
  FinanceMoney,
  FinanceNotice,
  FinancePanel,
  FinanceShell,
  FinanceSteps,
  SourceLink,
} from '../components/finance-shared.tsx';
import { CommercePager } from '../components/commerce-shared.tsx';
import {
  TradeCancelForm,
  TradeConvertForm,
  TradeQuantityForm,
  type TradeSelection,
} from '../components/trade-forms.tsx';

export function TradePage() {
  return <TradeWorkspace key={financeIdentity()} />;
}
function TradeWorkspace() {
  const { t } = useLocale(),
    access = useFinanceAccess(),
    actions = access.data?.actions.map((action) => action.name) ?? [],
    allowed = actions.includes('trade.board');
  const [direction, setDirection] = useState<'sales' | 'purchase'>('sales'),
    [all, setAll] = useState(false),
    [offset, setOffset] = useState(0),
    [quotationOffset, setQuotationOffset] = useState(0),
    [orderId, setOrderId] = useState(''),
    [selection, setSelection] = useState<TradeSelection>();
  const board = useFinanceRead(
      'trade.board',
      { direction, status: all ? 'all' : 'open', limit: 100, offset },
      allowed,
      boardOutput.parse,
    ),
    detail = useFinanceRead('trade.order_detail', { orderId }, allowed && Boolean(orderId), detailOutput.parse);
  const quotations = useFinanceList(
      'trade_quotation',
      { docstatus: 1 },
      allowed && direction === 'sales' && actions.includes('trade.convert_quotation'),
      quotationOffset,
    ),
    sources = [access, board, detail, quotations],
    busy = sources.some((source) => source.isFetching || source.isError),
    close = () => setSelection(undefined);
  return (
    <FinanceShell
      title={{ ja: '商流・受発注', en: 'Trade and orders' }}
      subtitle={{
        ja: '見積から受注・出荷・請求へ。発注と入荷も、明細ごとの残数と原資料でつながります。',
        en: 'Connect quotations, orders, shipments and invoices. Track purchasing and receipts with source documents and line-level balances.',
      }}
      eyebrow="TRADE FLOW"
      allowed={allowed}
      ready={Boolean(access.data)}
      sources={sources}
    >
      <FinanceSteps
        steps={
          direction === 'sales'
            ? [
                { ja: '見積', en: 'Quote' },
                { ja: '受注', en: 'Sales order' },
                { ja: '出荷・分納', en: 'Ship / partial delivery' },
                { ja: '請求・入金', en: 'Invoice / receipt' },
              ]
            : [
                { ja: '発注', en: 'Purchase order' },
                { ja: '入荷・分納', en: 'Receive / partial delivery' },
                { ja: '仕入請求', en: 'Supplier invoice' },
                { ja: '支払・銀行照合', en: 'Pay / reconcile' },
              ]
        }
      />
      <div className="finance-toolbar">
        <div className="finance-tabs">
          <button
            aria-pressed={direction === 'sales'}
            onClick={() => {
              setDirection('sales');
              setOffset(0);
              setOrderId('');
            }}
          >
            {t({ ja: '販売', en: 'Sales' })}
          </button>
          <button
            aria-pressed={direction === 'purchase'}
            onClick={() => {
              setDirection('purchase');
              setOffset(0);
              setOrderId('');
            }}
          >
            {t({ ja: '仕入', en: 'Purchasing' })}
          </button>
        </div>
        <div className="finance-buttons">
          {direction === 'sales' ? (
            <Link className="btn" to="/e/$entity/new" params={{ entity: 'trade_quotation' }}>
              {t({ ja: '見積を登録', en: 'New quotation' })}
            </Link>
          ) : null}
          <Link className="btn btn-primary" to="/e/$entity/new" params={{ entity: 'trade_order' }}>
            {t({ ja: '受発注を登録', en: 'New sales / purchase order' })}
          </Link>
          <Link className="btn" to="/finance/banking">
            {t({ ja: '銀行照合へ', en: 'Bank reconciliation' })}
          </Link>
        </div>
      </div>
      <FinancePanel
        title={t({ ja: '注文と残数', en: 'Orders and remaining work' })}
        note={t({
          ja: '数量は品目・単位ごとに管理します。「残数明細」は処理が残る明細の件数です。',
          en: 'Quantities are tracked by item and unit. Open lines count lines with remaining work.',
        })}
        actions={
          <label>
            <input
              type="checkbox"
              checked={all}
              onChange={(event) => {
                setAll(event.target.checked);
                setOffset(0);
              }}
            />
            {t({ ja: '下書き・取消も表示', en: 'Include drafts and cancelled orders' })}
          </label>
        }
      >
        {!board.data ? (
          <p role="status">{t({ ja: '注文を取得中…', en: 'Loading orders…' })}</p>
        ) : !board.data.rows.length ? (
          <FinanceEmpty>
            {t({
              ja: '対象の注文はありません。受発注を登録し、明細を確認して確定してください。',
              en: 'No orders in this view. Create an order, review its lines and submit it.',
            })}
          </FinanceEmpty>
        ) : (
          <div className="finance-table-wrap">
            <table className="finance-table">
              <thead>
                <tr>
                  <th>{t({ ja: '注文・取引先', en: 'Order / partner' })}</th>
                  <th>{t({ ja: '納期', en: 'Required date' })}</th>
                  <th>{t({ ja: '金額', en: 'Amount' })}</th>
                  <th>{t({ ja: '残数明細 / 未請求明細', en: 'Open / unbilled lines' })}</th>
                  <th>{t({ ja: '状態', en: 'Status' })}</th>
                </tr>
              </thead>
              <tbody>
                {board.data.rows.map((row) => (
                  <tr key={row.id} data-selected={row.id === orderId}>
                    <td>
                      <button className="btn" disabled={busy} onClick={() => setOrderId(row.id)}>
                        {row.number}
                      </button>
                      <small>{row.partner}</small>
                    </td>
                    <td>
                      {row.requiredDate ?? '—'}
                      <small>{row.date}</small>
                    </td>
                    <td data-money>
                      <FinanceMoney value={row.total} />
                    </td>
                    <td>
                      {row.openLineCount} / {row.unbilledLineCount}
                    </td>
                    <td>
                      <span className="finance-badge">{t(tradeStatus(row.status))}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <CommercePager offset={offset} total={board.data?.total ?? 0} onPage={setOffset} />
      </FinancePanel>
      {detail.data ? <TradeDetail detail={detail.data} busy={busy} actions={actions} onSelect={setSelection} /> : null}
      {direction === 'sales' && actions.includes('trade.convert_quotation') ? (
        <FinancePanel
          title={t({ ja: '確定済みの見積', en: 'Submitted quotations' })}
          actions={
            <Link className="btn" to="/e/$entity" params={{ entity: 'trade_quotation' }}>
              {t({ ja: '見積一覧', en: 'All quotations' })}
            </Link>
          }
        >
          <div className="commerce-list">
            {quotations.data?.items.map((row) => (
              <article className="commerce-list-item" key={row.id}>
                <div>
                  <SourceLink entity="trade_quotation" id={row.id}>
                    {String(row.number)}
                  </SourceLink>
                  <small>{String(row.date)}</small>
                </div>
                <FinanceMoney value={String(row.total)} />
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => setSelection({ type: 'convert', quotation: row })}
                >
                  {t({ ja: '受注へ引き継ぐ', en: 'Convert to order' })}
                </button>
              </article>
            ))}
          </div>
          <CommercePager offset={quotationOffset} total={quotations.data?.total ?? 0} onPage={setQuotationOffset} />
        </FinancePanel>
      ) : null}
      <FinanceNotice>
        {t({
          ja: '初版はJPY・税抜単価・固定の在庫単位を使う物品取引です。会計は請求時に転記します。入荷時の未請求債務や原価差額の配賦は含みません。',
          en: 'This release supports JPY goods transactions with tax-exclusive prices and fixed stock units. Accounting is posted at invoicing; unbilled receipt accruals and cost-variance allocation are not included.',
        })}
      </FinanceNotice>
      {selection?.type === 'fulfill' || selection?.type === 'bill' ? (
        <TradeQuantityForm
          selection={selection}
          stale={sources.some((source) => source.isError) || !allowed}
          onClose={close}
        />
      ) : selection?.type === 'convert' ? (
        <TradeConvertForm
          onCreated={(id) => {
            setAll(true);
            setOffset(0);
            setOrderId(id);
          }}
          row={selection.quotation}
          stale={sources.some((source) => source.isError) || !allowed}
          onClose={close}
        />
      ) : selection ? (
        <TradeCancelForm
          selection={selection}
          stale={sources.some((source) => source.isError) || !allowed}
          onClose={close}
        />
      ) : null}
    </FinanceShell>
  );
}

function tradeStatus(status: TradeOrderDetail['order']['status']) {
  return {
    draft: { ja: '下書き', en: 'Draft' },
    open: { ja: '処理中', en: 'Open' },
    fulfilled: { ja: '履行済み', en: 'Fulfilled' },
    closed: { ja: '終了', en: 'Closed' },
    cancelled: { ja: '取消', en: 'Cancelled' },
  }[status];
}

function TradeDetail({
  detail,
  busy,
  actions,
  onSelect,
}: {
  detail: TradeOrderDetail;
  busy: boolean;
  actions: string[];
  onSelect: (selection: TradeSelection) => void;
}) {
  const { t } = useLocale(),
    order = detail.order,
    active = order.docstatus === 1 && order.status !== 'closed';
  return (
    <FinancePanel
      title={`${order.number} · ${order.partner}`}
      actions={
        <div className="finance-buttons">
          <SourceLink entity="trade_order" id={order.id}>
            {t({ ja: '注文の原資料', en: 'Order source' })}
          </SourceLink>
          {active && actions.includes('trade.fulfill_order') ? (
            <button
              className="btn btn-primary"
              disabled={busy || order.openLineCount === 0}
              onClick={() => onSelect({ type: 'fulfill', detail })}
            >
              {t(
                order.direction === 'sales'
                  ? { ja: '出荷数量を入力', en: 'Enter shipment' }
                  : { ja: '入荷数量を入力', en: 'Enter receipt' },
              )}
            </button>
          ) : null}
          {active && actions.includes('trade.close_order') ? (
            <button className="btn" disabled={busy} onClick={() => onSelect({ type: 'close', detail })}>
              {t({ ja: '残数を終了', en: 'Close remainder' })}
            </button>
          ) : null}
        </div>
      }
    >
      {order.docstatus === 0 ? (
        <FinanceNotice>
          {t({
            ja: '受注の下書きを作成しました。「注文の原資料」で内容を確認し、確定してください。',
            en: 'The order draft is ready. Open Order source, review the details and submit it.',
          })}
        </FinanceNotice>
      ) : null}
      <div className="finance-table-wrap">
        <table className="finance-table">
          <thead>
            <tr>
              <th>{t({ ja: '品目・単位', en: 'Item / unit' })}</th>
              <th>{t({ ja: '注文数量', en: 'Ordered' })}</th>
              <th>{t({ ja: '履行済み', en: 'Fulfilled' })}</th>
              <th>{t({ ja: '未履行', en: 'Remaining' })}</th>
              <th>{t({ ja: '請求済み / 未請求', en: 'Billed / unbilled' })}</th>
            </tr>
          </thead>
          <tbody>
            {detail.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  {line.description}
                  <small>{line.uomCode}</small>
                </td>
                <td>{line.quantity}</td>
                <td>{line.fulfilledQuantity}</td>
                <td>{line.remainingQuantity}</td>
                <td>
                  {line.billedQuantity} / {line.unbilledQuantity}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {order.closedReason ? <FinanceNotice>{order.closedReason}</FinanceNotice> : null}
      {detail.fulfillments.map((row) => (
        <section className="finance-download" key={row.id}>
          <div className="finance-toolbar">
            <div>
              <strong>
                {row.number} · {row.date} · {row.warehouse}
              </strong>
              <small> {row.docstatus === 2 ? t({ ja: '取消済み', en: 'Cancelled' }) : ''}</small>
            </div>
            <div className="finance-buttons">
              <SourceLink entity="stock_entry" id={row.stockEntryId}>
                {t({ ja: '入出庫伝票', en: 'Stock entry' })}
              </SourceLink>
              {row.docstatus === 1 ? (
                <>
                  <button
                    className="btn btn-primary"
                    disabled={busy || !actions.includes('trade.bill_fulfillment')}
                    onClick={() => onSelect({ type: 'bill', detail, fulfillment: row })}
                  >
                    {t({ ja: '請求数量を入力', en: 'Enter invoice quantities' })}
                  </button>
                  <button
                    className="btn"
                    disabled={busy || !actions.includes('trade.cancel_fulfillment')}
                    onClick={() => onSelect({ type: 'cancel-fulfillment', detail, fulfillment: row })}
                  >
                    {t({ ja: '履行を取消', en: 'Cancel fulfillment' })}
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <ul className="finance-reasons">
            {row.lines.map((line) => (
              <li key={line.id}>
                {line.description} · {line.quantity} {line.uomCode} / {t({ ja: '未請求', en: 'Unbilled' })}{' '}
                {line.unbilledQuantity}
              </li>
            ))}
          </ul>
          {row.billings.map((billing) => (
            <div className="finance-toolbar" key={billing.id}>
              <SourceLink entity={billing.invoiceEntity} id={billing.invoiceId}>
                {billing.invoiceNumber ?? billing.number}
              </SourceLink>
              <FinanceMoney value={billing.total} />
              {billing.docstatus === 2 ? (
                <span className="finance-badge">{t({ ja: '取消済み', en: 'Cancelled' })}</span>
              ) : (
                <button
                  className="btn"
                  disabled={busy || !actions.includes('trade.cancel_billing')}
                  onClick={() => onSelect({ type: 'cancel-billing', billing })}
                >
                  {t({ ja: 'この請求を取消', en: 'Cancel this billing' })}
                </button>
              )}
            </div>
          ))}
        </section>
      ))}
    </FinancePanel>
  );
}
