import { useState } from 'react';
import {
  filingBoardOutput,
  filingDetailOutput,
  type FilingBoard,
  type FilingDetail,
  type FilingIssue,
  type FilingKind,
} from '@daifuku/mod-tax-filing/contract';
import { financeIdentity, useFinanceAccess, useFinanceRead } from '../api/finance.ts';
import { getUser } from '../api/client.ts';
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
import { FilingAccountingProfile } from '../components/filing-accounting-profile.tsx';
import { FilingPayrollProfile } from '../components/filing-payroll-profile.tsx';
import { FilingDownloads, FilingPrepare, FilingReview } from '../components/filing-commands.tsx';

type Dialog =
  | { type: 'profile'; board: FilingBoard }
  | { type: 'prepare'; previous?: FilingDetail }
  | { type: 'confirm' | 'cancel' | 'export'; detail: FilingDetail };
export function TaxFilingPage() {
  return <FilingWorkspace key={financeIdentity()} />;
}
function FilingWorkspace() {
  const { t } = useLocale(),
    access = useFinanceAccess(),
    actions = access.data?.actions.map((action) => action.name) ?? [];
  const kinds = (['accounting', 'payroll'] as const).filter((kind) =>
    access.data?.entities.some((entity) => entity.name === `filing_${kind}_pack` && entity.ops.includes('read')),
  );
  const [requestedKind, setKind] = useState<FilingKind>(),
    kind = requestedKind && kinds.includes(requestedKind) ? requestedKind : (kinds[0] ?? 'accounting'),
    allowed = actions.includes('tax_filing.board') && kinds.includes(kind);
  const [id, setId] = useState(''),
    [dialog, setDialog] = useState<Dialog>();
  const query = useFinanceRead('tax_filing.board', { kind }, allowed, filingBoardOutput.parse),
    detail = useFinanceRead('tax_filing.get', { kind, id }, allowed && Boolean(id), filingDetailOutput.parse);
  const sources = [access, query, detail],
    busy = sources.some((source) => source.isFetching || source.isError),
    stale = !allowed || sources.some((source) => source.isError),
    board = query.data,
    close = () => setDialog(undefined);
  const profileAction = `tax_filing.save_${kind}_profile`,
    profileExists = kind === 'accounting' ? Boolean(board?.accountingProfile) : Boolean(board?.payrollProfile);
  const profileChanged =
    dialog?.type === 'profile' &&
    (kind === 'accounting'
      ? dialog.board.accountingProfile?.version !== board?.accountingProfile?.version
      : dialog.board.payrollProfile?.version !== board?.payrollProfile?.version);
  return (
    <FinanceShell
      title={{ ja: '申告準備', en: 'Filing preparation' }}
      subtitle={{
        ja: '帳簿と給与の根拠を固定し、検算・確認・出力へ。未確認事項と提出に必要な作業を見える形にします。',
        en: 'Capture accounting and payroll evidence, validate it, review and export. Keep outstanding facts and submission work visible.',
      }}
      eyebrow="FILING DESK"
      allowed={allowed}
      ready={Boolean(access.data)}
      sources={sources}
    >
      <FinanceSteps
        steps={[
          { ja: '作成条件を設定', en: 'Set up profiles' },
          { ja: '原資料を固定', en: 'Capture sources' },
          { ja: '検算・内容確認', en: 'Validate and review' },
          { ja: 'ファイル出力', en: 'Export files' },
        ]}
      />
      <div className="finance-toolbar">
        <div className="finance-tabs">
          {kinds.map((value) => (
            <button
              key={value}
              aria-pressed={kind === value}
              onClick={() => {
                setKind(value);
                setId('');
                setDialog(undefined);
              }}
            >
              {t(
                value === 'accounting'
                  ? { ja: '会計・財務諸表', en: 'Accounting statements' }
                  : { ja: '給与の申告準備', en: 'Payroll preparation' },
              )}
            </button>
          ))}
        </div>
        <div className="finance-buttons">
          {actions.includes(profileAction) ? (
            <button
              className="btn"
              disabled={busy || !board || board.truncated}
              onClick={() => {
                if (board) setDialog({ type: 'profile', board });
              }}
            >
              {t({ ja: '作成条件・補足情報', en: 'Profiles and supplemental facts' })}
            </button>
          ) : null}
          {actions.includes(`tax_filing.prepare_${kind}`) ? (
            <button
              className="btn btn-primary"
              disabled={busy || !board || board.truncated || !profileExists}
              onClick={() => setDialog({ type: 'prepare' })}
            >
              {t({ ja: '準備資料を作成', en: 'Create preparation' })}
            </button>
          ) : null}
        </div>
      </div>
      <FinanceNotice>
        {t(
          kind === 'accounting'
            ? {
                ja: '一般商工業の法人・単体・税抜帳簿に対応します。e-Tax用の貸借対照表・損益計算書の取込データを作ります。申告書全体の作成や送信・税務署の受理を行う機能ではありません。',
                en: 'For standalone general-commercial corporations using tax-exclusive books. Create e-Tax balance-sheet and income-statement import data. Full tax return preparation, submission and acceptance are outside this workflow.',
              }
            : {
                ja: '給与は2026年の確定給与・年末調整と補足情報から準備資料を作ります。出力CSVは確認用で、e-Tax・eLTAXへの直接取込や送信には対応していません。',
                en: 'Prepare payroll evidence from finalized 2026 payroll, year-end adjustments and supplemental facts. CSV output is for review, not direct e-Tax/eLTAX import or submission.',
              },
        )}
      </FinanceNotice>
      {!board ? (
        <p role="status">{t({ ja: '資料を取得しています…', en: 'Loading preparations…' })}</p>
      ) : (
        <>
          {!profileExists ? (
            <FinanceNotice>
              {t({
                ja: 'まず「作成条件・補足情報」で対象仕様と確認した情報を保存してください。',
                en: 'Save the selected profile and verified facts in Profiles and supplemental facts first.',
              })}
            </FinanceNotice>
          ) : null}
          <FinancePanel
            title={t({ ja: '準備資料の履歴', en: 'Preparation history' })}
            note={t({
              ja: '確認済みでも行政への提出は別途必要です。訂正時は新しい資料を作り、以前の版を残します。',
              en: 'Confirmation does not submit to authorities. Corrections create new preparations and retain earlier versions.',
            })}
          >
            {!board.packs.length ? (
              <FinanceEmpty>{t({ ja: '準備資料はまだありません。', en: 'No preparations yet.' })}</FinanceEmpty>
            ) : (
              <div className="finance-table-wrap">
                <table className="finance-table">
                  <thead>
                    <tr>
                      <th>{t({ ja: '対象期間', en: 'Period' })}</th>
                      <th>{t({ ja: '資料の状態', en: 'Preparation status' })}</th>
                      <th>{t({ ja: '確認事項', en: 'Validation issues' })}</th>
                      <th>{t({ ja: '内容', en: 'Details' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.packs.map((row) => (
                      <tr key={row.id} data-selected={row.id === id}>
                        <td>
                          {row.from} ～ {row.to}
                          <small>{row.countryProfile}</small>
                        </td>
                        <td>
                          <span className="finance-badge">
                            {t(
                              row.status === 'draft'
                                ? { ja: '下書き', en: 'Draft' }
                                : row.status === 'confirmed'
                                  ? { ja: '資料確認済み・未提出', en: 'Reviewed / not submitted' }
                                  : { ja: '取消済み', en: 'Cancelled' },
                            )}
                          </span>
                        </td>
                        <td>
                          {row.issues.filter((issue) => issue.severity === 'error').length}{' '}
                          {t({ ja: 'エラー', en: 'errors' })} /{' '}
                          {row.issues.filter((issue) => issue.severity === 'warning').length}{' '}
                          {t({ ja: '注意', en: 'warnings' })}
                        </td>
                        <td>
                          <button className="btn" disabled={busy} onClick={() => setId(row.id)}>
                            {t({ ja: '根拠と検算を確認', en: 'Review evidence and validation' })}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </FinancePanel>
          {detail.data ? (
            <FilingDetails detail={detail.data} busy={busy} actions={actions} onDialog={setDialog} />
          ) : null}
          {board.truncated ? (
            <FinanceNotice>
              {t({
                ja: '件数上限に達したため、一部の資料だけを表示しています。対象の完全性を確認するまで新規作成を停止しています。',
                en: 'This view reached its record limit. New preparation is disabled until source completeness can be verified.',
              })}
            </FinanceNotice>
          ) : null}
          {dialog?.type === 'profile' ? (
            kind === 'accounting' ? (
              <FilingAccountingProfile board={dialog.board} stale={stale || profileChanged} onClose={close} />
            ) : (
              <FilingPayrollProfile board={dialog.board} stale={stale || profileChanged} onClose={close} />
            )
          ) : dialog?.type === 'prepare' ? (
            <FilingPrepare board={board} previous={dialog.previous} stale={stale} onCreated={setId} onClose={close} />
          ) : dialog?.type === 'export' ? (
            <FilingDownloads
              detail={dialog.detail}
              stale={
                stale ||
                !detail.data ||
                detail.data.id !== dialog.detail.id ||
                detail.data.version !== dialog.detail.version ||
                detail.data.status !== 'confirmed' ||
                detail.data.stale
              }
              onClose={close}
            />
          ) : dialog ? (
            <FilingReview detail={dialog.detail} mode={dialog.type} stale={stale} onClose={close} />
          ) : null}
        </>
      )}
    </FinanceShell>
  );
}

function FilingDetails({
  detail,
  busy,
  actions,
  onDialog,
}: {
  detail: FilingDetail;
  busy: boolean;
  actions: string[];
  onDialog: (dialog: Dialog) => void;
}) {
  const { t } = useLocale(),
    hasErrors = detail.issues.some((issue) => issue.severity === 'error'),
    ownDraft = detail.status === 'draft' && detail.preparedBy === getUser()?.id;
  return (
    <FinancePanel
      title={t({ ja: '根拠と検算', en: 'Evidence and validation' })}
      actions={
        <div className="finance-buttons">
          {actions.includes(`tax_filing.prepare_${detail.kind}`) ? (
            <button className="btn" disabled={busy} onClick={() => onDialog({ type: 'prepare', previous: detail })}>
              {t({ ja: '最新資料で再作成', en: 'Recreate from current sources' })}
            </button>
          ) : null}
          {detail.status === 'draft' && !ownDraft && actions.includes('tax_filing.confirm') ? (
            <button
              className="btn btn-primary"
              disabled={busy || detail.stale || hasErrors}
              onClick={() => onDialog({ type: 'confirm', detail })}
            >
              {t({ ja: '資料の確認へ', en: 'Confirm preparation' })}
            </button>
          ) : null}
          {detail.status === 'confirmed' && actions.includes('tax_filing.export') ? (
            <button
              className="btn btn-primary"
              disabled={busy || detail.stale || hasErrors}
              onClick={() => onDialog({ type: 'export', detail })}
            >
              {t({ ja: 'ファイルを取得', en: 'Download files' })}
            </button>
          ) : null}
          {detail.status !== 'cancelled' && actions.includes('tax_filing.cancel') ? (
            <button className="btn" disabled={busy} onClick={() => onDialog({ type: 'cancel', detail })}>
              {t({ ja: '資料を取消', en: 'Cancel preparation' })}
            </button>
          ) : null}
        </div>
      }
    >
      <FinanceNotice>{detail.notice}</FinanceNotice>
      {detail.stale ? (
        <p className="finance-notice finance-warning" role="status">
          {t({
            ja: '作成後に根拠資料または設定が変わっています。最新資料で再作成してください。',
            en: 'Sources or settings changed after preparation. Recreate from the current sources.',
          })}
        </p>
      ) : null}
      <FilingIssues issues={detail.issues} />
      {ownDraft ? (
        <FinanceNotice>
          {t({
            ja: '作成者以外の担当者が原資料と検算結果を確認してください。',
            en: 'Another authorized reviewer must check the sources and validation results.',
          })}
        </FinanceNotice>
      ) : null}
      {detail.statements.map((statement) => (
        <section key={statement.kind}>
          <h3>
            {t(
              statement.kind === 'BS'
                ? { ja: '貸借対照表', en: 'Balance sheet' }
                : { ja: '損益計算書', en: 'Income statement' },
            )}
          </h3>
          <div className="finance-table-wrap">
            <table className="finance-table">
              <thead>
                <tr>
                  <th>{t({ ja: '科目', en: 'Account' })}</th>
                  <th>{t({ ja: '金額（円）', en: 'Amount (JPY)' })}</th>
                </tr>
              </thead>
              <tbody>
                {statement.rows.map((row, index) => (
                  <tr key={`${row.code}:${index}`}>
                    <td style={{ paddingInlineStart: `${Math.min(row.level, 6) * 0.65 + 0.65}rem` }}>{row.label}</td>
                    <td data-money>{row.amount === null ? '—' : <FinanceMoney value={row.amount} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {detail.payrollRows.length ? (
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead>
              <tr>
                <th>{t({ ja: '従業員', en: 'Employee' })}</th>
                <th>{t({ ja: '課税給与', en: 'Taxable salary' })}</th>
                <th>{t({ ja: '年税額', en: 'Annual tax' })}</th>
                <th>{t({ ja: '補足・確認事項', en: 'Supplemental facts / issues' })}</th>
              </tr>
            </thead>
            <tbody>
              {detail.payrollRows.map((row) => (
                <tr key={row.employeeId}>
                  <td>
                    {row.employeeCode} · {row.employeeName}
                    <small>
                      {row.payrollCount} {t({ ja: '給与資料', en: 'payroll records' })}
                    </small>
                  </td>
                  <td data-money>{row.taxablePay === null ? '—' : <FinanceMoney value={row.taxablePay} />}</td>
                  <td data-money>{row.annualTax === null ? '—' : <FinanceMoney value={row.annualTax} />}</td>
                  <td>
                    <FilingIssues issues={row.issues} />
                    {row.adjustmentId ? (
                      <SourceLink entity="workforce_year_end_adjustment" id={row.adjustmentId}>
                        {t({ ja: '年末調整', en: 'Year-end adjustment' })}
                      </SourceLink>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <details className="finance-download">
        <summary>
          {t({
            ja: `原資料 ${detail.sourceCount}件・根拠ハッシュ`,
            en: `${detail.sourceCount} source records and source hash`,
          })}
        </summary>
        <code>{detail.sourceHash}</code>
        <ul className="finance-reasons">
          {detail.sourceVersions.map((source) => (
            <li key={`${source.entity}:${source.id}`}>
              <SourceLink entity={source.entity} id={source.id}>
                {source.entity} · {source.id}
              </SourceLink>{' '}
              v{source.version}
            </li>
          ))}
        </ul>
      </details>
    </FinancePanel>
  );
}
function FilingIssues({ issues }: { issues: FilingIssue[] }) {
  return issues.length ? (
    <ul className="finance-reasons">
      {issues.map((issue, index) => (
        <li className={issue.severity === 'error' ? 'finance-inline-error' : ''} key={`${issue.code}:${index}`}>
          {issue.message}
          {issue.reference ? <small> · {issue.reference}</small> : null}
        </li>
      ))}
    </ul>
  ) : null;
}
