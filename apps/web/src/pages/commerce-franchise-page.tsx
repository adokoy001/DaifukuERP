import { useCommerceCopy } from '../components/commerce-copy.ts';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { commerceIdentity, useCommerceList, useCommerceRead, type FranchiseBoard } from '../api/commerce.ts';
import type { RecordJson } from '../api/types.ts';
import {
  CommerceEmpty,
  CommerceMetric,
  CommerceMoney,
  CommercePager,
  CommercePanel,
  CommerceShell,
  SourceLink,
  useCommerceAccess,
} from '../components/commerce-shared.tsx';
import { CommerceFranchiseGenerate, CommerceFranchisePayment } from '../components/commerce-franchise-forms.tsx';
import { ReadRecoveryProvider } from '../components/read-refresh-notice.tsx';
export function CommerceFranchisePage() {
  return <FranchiseWorkspace key={commerceIdentity()} />;
}
function FranchiseWorkspace() {
  const copy = useCommerceCopy();
  const { allowed, actions } = useCommerceAccess('franchise.board'),
    [offset, setOffset] = useState(0),
    [agreementOffset, setAgreementOffset] = useState(0),
    [id, setId] = useState(''),
    [generate, setGenerate] = useState<RecordJson>(),
    [confirm, setConfirm] = useState<{
      board: FranchiseBoard;
      mode: 'settle' | 'cancel';
    }>();
  const agreements = useCommerceList('franchise_agreement', allowed, agreementOffset),
    settlements = useCommerceList('franchise_settlement', allowed, offset),
    board = useCommerceRead<FranchiseBoard>('franchise.board', { settlementId: id }, allowed && Boolean(id));
  const readers = [agreements, settlements, board],
    busy = readers.some((q) => q.isFetching),
    value = board.data;
  return (
    <CommerceShell
      title={copy('FC月次精算')}
      subtitle={copy(
        '契約条件と確定売上資料を固定してロイヤリティを計算し、請求・入出金・取消まで一つの根拠でつなぎます。',
      )}
      action="franchise.board"
      sources={readers}
    >
      <ReadRecoveryProvider sources={readers}>
        <CommercePanel
          title={copy('1. 精算契約を選択')}
          note={copy(
            '税込・税抜の基準、率、定額、丸め、税区分は契約ごとに指定します。使用済み契約は変更せず、新期間の契約を追加してください。',
          )}
          actions={
            <Link className="btn" to="/e/$entity" params={{ entity: 'franchise_agreement' }}>
              {copy('契約を管理')}
            </Link>
          }
        >
          <div className="commerce-list">
            {agreements.data?.items.map((row) => (
              <div className="commerce-list-item" key={row.id}>
                <div>
                  <strong>
                    {String(row.code)} · {String(row.name)}
                  </strong>
                  <small>
                    {String(row.startDate)} ～ {String(row.endDate)} ·{' '}
                    {row.direction === 'bill' ? copy('請求') : copy('支払請求')} ·{' '}
                    {row.basis === 'gross' ? copy('税込売上') : copy('税抜売上')}
                    {copy('基準')}
                  </small>
                </div>
                {actions.includes('franchise.generate') ? (
                  <button
                    className="btn btn-primary"
                    disabled={busy || agreements.isError}
                    onClick={() => setGenerate(row)}
                  >
                    {copy('この契約で月次精算')}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {agreements.data?.total === 0 ? (
            <CommerceEmpty>{copy('取引先と契約条件を登録すると、月次精算を開始できます。')}</CommerceEmpty>
          ) : null}
          <CommercePager offset={agreementOffset} total={agreements.data?.total ?? 0} onPage={setAgreementOffset} />
        </CommercePanel>
        {value ? (
          <div className="commerce-detail">
            <div className="commerce-cards">
              <CommerceMetric
                title={copy('契約による精算料（税抜）')}
                value={value.fee}
                note={
                  copy('') +
                  (value.contract.basis === 'gross' ? copy('税込売上') : copy('税抜売上')) +
                  copy('基準 · 率 ') +
                  value.contract.rate +
                  copy('')
                }
              />
              <CommerceMetric
                title={copy('請求税込額')}
                value={value.total}
                note={copy('消費税 ') + value.tax + copy(' 円 · 請求書計算値')}
              />
              <CommerceMetric
                title={copy('現在の未決済残高')}
                value={value.balance}
                note={copy('入出金済 ') + value.paidAmount + copy(' 円')}
              />
            </div>
            <CommercePanel
              title={`${value.contract.name} · ${value.month}`}
              note={copy('') + value.date + copy(' 請求 · ') + value.dueDate + copy(' 期日')}
              actions={
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    void board.refetch();
                    void settlements.refetch();
                  }}
                >
                  {copy('残高を再取得')}
                </button>
              }
            >
              <div className="commerce-detail">
                <dl>
                  <dt>{copy('精算状態')}</dt>
                  <dd>
                    <span className="commerce-badge" data-status={value.status}>
                      {value.status === 'paid'
                        ? copy('連動入出金生成済み')
                        : value.status === 'cancelled'
                          ? copy('取消済み')
                          : copy('請求生成済み')}
                    </span>
                  </dd>
                  <dt>{copy('売上資料')}</dt>
                  <dd className="commerce-reason">{value.sourceReference}</dd>
                  <dt>{copy('税込 / 税抜売上')}</dt>
                  <dd>
                    <CommerceMoney value={value.grossSales} /> / <CommerceMoney value={value.netSales} />
                  </dd>
                  <dt>{copy('請求書')}</dt>
                  <dd>
                    <SourceLink
                      entity={value.direction === 'bill' ? 'sales_invoice' : 'purchase_invoice'}
                      id={value.invoiceId}
                    >
                      {value.invoiceNumber ?? copy('請求書を確認')}
                    </SourceLink>
                  </dd>
                  <dt>{copy('連動入出金')}</dt>
                  <dd>
                    <SourceLink entity="payment" id={value.paymentId}>
                      {copy('入出金を確認')}
                    </SourceLink>
                  </dd>
                  {value.cancelledDate ? (
                    <>
                      <dt>{copy('取消有効日・理由')}</dt>
                      <dd>
                        {value.cancelledDate} · {value.cancelReason}
                      </dd>
                    </>
                  ) : null}
                </dl>
                <div className="commerce-action-row">
                  {value.status !== 'cancelled' &&
                  !value.paymentId &&
                  value.balance !== '0' &&
                  actions.includes('franchise.settle') ? (
                    <button
                      className="btn btn-primary"
                      disabled={busy || board.isError}
                      onClick={() => setConfirm({ board: value, mode: 'settle' })}
                    >
                      {copy('2. 入出金を確認')}
                    </button>
                  ) : null}
                  {value.status !== 'cancelled' && actions.includes('franchise.cancel') ? (
                    <button
                      className="btn"
                      disabled={busy || board.isError}
                      onClick={() => setConfirm({ board: value, mode: 'cancel' })}
                    >
                      {copy('精算を取消')}
                    </button>
                  ) : null}
                </div>
              </div>
            </CommercePanel>
          </div>
        ) : id && board.isFetching ? (
          <p role="status">{copy('最新の精算・残高を取得しています…')}</p>
        ) : null}
        <CommercePanel
          title={copy('月次精算の履歴')}
          note={copy('同じ契約・同じ月の再実行で二重請求は作りません。訂正は理由を残して取消し、改めて作成します。')}
        >
          <div className="commerce-table-wrap">
            <table className="commerce-table">
              <thead>
                <tr>
                  <th>{copy('月')}</th>
                  <th>{copy('契約')}</th>
                  <th>{copy('方向')}</th>
                  <th>{copy('税込額')}</th>
                  <th>{copy('状態')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {settlements.data?.items.map((row) => (
                  <tr key={row.id}>
                    <td>{String(row.month)}</td>
                    <td>
                      <SourceLink entity="franchise_agreement" id={String(row.agreementId)}>
                        {String((row.contract as Record<string, unknown> | null)?.name ?? copy('契約'))}
                      </SourceLink>
                    </td>
                    <td>{row.direction === 'bill' ? copy('請求') : copy('支払請求')}</td>
                    <td className="money">
                      <CommerceMoney value={String(row.total)} />
                    </td>
                    <td>
                      <span className="commerce-badge" data-status={String(row.status)}>
                        {row.status === 'paid'
                          ? copy('入出金生成済み')
                          : row.status === 'cancelled'
                            ? copy('取消済み')
                            : copy('請求生成済み')}
                      </span>
                    </td>
                    <td>
                      <button className="btn" onClick={() => setId(row.id)}>
                        {copy('根拠と残高')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {settlements.data?.total === 0 ? <CommerceEmpty>{copy('月次精算はまだありません。')}</CommerceEmpty> : null}
          <CommercePager offset={offset} total={settlements.data?.total ?? 0} onPage={setOffset} />
        </CommercePanel>
        {generate && agreements.data ? (
          <CommerceFranchiseGenerate
            agreement={generate}
            stale={agreements.data.items.find((a) => a.id === generate.id)?.version !== generate.version}
            onClose={() => setGenerate(undefined)}
            onSaved={setId}
          />
        ) : null}
        {confirm && value ? (
          <CommerceFranchisePayment
            {...confirm}
            stale={value.version !== confirm.board.version || value.balance !== confirm.board.balance}
            onClose={() => setConfirm(undefined)}
          />
        ) : null}
      </ReadRecoveryProvider>
    </CommerceShell>
  );
}
