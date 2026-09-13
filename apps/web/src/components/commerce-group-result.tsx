import { useCommerceCopy } from './commerce-copy.ts';
import { useCommerceTask, type GroupBoard } from '../api/commerce.ts';
import { CommerceDialog, CommerceMetric, CommercePanel, CommerceMoney } from './commerce-shared.tsx';
export function CommerceGroupResult({ board }: { board: GroupBoard }) {
  const copy = useCommerceCopy();
  return (
    <div className="commerce-detail">
      <div className="commerce-cards">
        <CommerceMetric
          title={copy('連結借方合計')}
          value={board.result.debit}
          note={copy('単体残高 ＋ 消去 ＋ 調整')}
        />
        <CommerceMetric
          title={copy('連結貸方合計')}
          value={board.result.credit}
          note={copy('借方・貸方はサーバーで一致確認')}
        />
        <article className="commerce-metric">
          <span>{copy('精算表の状態')}</span>
          <strong>
            {board.status === 'confirmed'
              ? copy('確定済み')
              : board.status === 'cancelled'
                ? copy('取消済み')
                : copy('下書き')}
          </strong>
          <small>
            {copy('対象')}
            {board.sources.length}
            {copy('社 · JPY')}
          </small>
        </article>
      </div>
      <CommercePanel
        title={board.name}
        note={copy('') + board.from + copy(' ～ ') + board.to + copy(' · 単体帳簿は変更しません')}
      >
        <div className="commerce-table-wrap">
          <table className="commerce-table">
            <thead>
              <tr>
                <th>{copy('連結科目')}</th>
                <th>{copy('単体合算')}</th>
                <th>{copy('消去')}</th>
                <th>{copy('調整')}</th>
                <th>{copy('連結残高')}</th>
              </tr>
            </thead>
            <tbody>
              {board.result.rows.map((row) => (
                <tr key={row.code}>
                  <td>
                    {row.code} · {row.name}
                  </td>
                  {(['standalone', 'elimination', 'adjustment', 'consolidated'] as const).map((key) => (
                    <td key={key} className="money">
                      <CommerceMoney value={row[key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="commerce-notice">
          {copy('残高は借方が正・貸方が負です。期間損益や法定連結財務諸表を自動生成したものではありません。')}
        </p>
        <details>
          <summary>{copy('保存した根拠・消去明細を確認')}</summary>
          <p className="commerce-reason">{board.reviewBasis}</p>
          {board.sources.map((s) => (
            <p key={s.companyId}>
              {s.code} · {s.name} ·{' '}
              {s.closed ? copy('保存時点で対象以前の全期間締め済み') : copy('保存時点で未締め期間あり')}
            </p>
          ))}
          {board.adjustments.map((a) => (
            <article key={a.key}>
              <strong>
                {a.kind === 'elimination' ? copy('消去') : copy('調整')} · {a.description}
              </strong>
              {a.lines.map((line, i) => (
                <p key={i}>
                  {line.groupCode}
                  {copy('· 借方')}
                  {line.debit}
                  {copy('/ 貸方')}
                  {line.credit}
                </p>
              ))}
            </article>
          ))}
          {board.reason ? (
            <p>
              {copy('確定・取消理由:')}
              {board.reason}
            </p>
          ) : null}
        </details>
      </CommercePanel>
    </div>
  );
}
export function CommerceGroupConfirm({
  board,
  mode,
  stale,
  onClose,
}: {
  board: GroupBoard;
  mode: 'confirm' | 'cancel';
  stale: boolean;
  onClose: () => void;
}) {
  const copy = useCommerceCopy();
  const task = useCommerceTask();
  return (
    <CommerceDialog
      title={mode === 'confirm' ? copy('連結精算表を確定') : copy('連結精算表を取消')}
      submitLabel={mode === 'confirm' ? copy('確認して確定') : copy('理由を記録して取消')}
      stale={stale}
      onClose={onClose}
      onSubmit={async (data) => {
        await task.mutateAsync({
          action: 'group_accounting.' + mode,
          input: { runId: board.id, expectedVersion: board.version, reason: String(data.get('reason') ?? '').trim() },
        });
      }}
    >
      <p className="commerce-notice">
        {mode === 'confirm'
          ? copy(
              '全社の対象・期首残高に関係する期間が締め済みで、保存後の単体資料が変わっていないことを再検証します。締めた直後は下書きを更新してください。',
            )
          : copy('取消後も保存資料・消去・調整は履歴に残ります。単体帳簿には変更を加えません。')}
      </p>
      <label>
        {copy('確認・取消理由')}
        <textarea className="input" name="reason" required maxLength={1000} rows={3} />
      </label>
    </CommerceDialog>
  );
}
