import { useState } from 'react';
import { formText, type ExpenseSummary } from '../api/workforce.ts';
import { useWorkforceTask } from '../api/workforce-query.ts';
import { useLocale } from '../i18n.tsx';
import { WorkforceReceipts } from './workforce-receipts.tsx';
import { WorkforceDialog } from './workforce-dialog.tsx';
import {
  WorkforceEmpty,
  WorkforceError,
  WorkforceMoney,
  WorkforcePanel,
  WorkforceStatus,
} from './workforce-shared.tsx';

function ExpenseForm({
  expense,
  today,
  stale,
  onSaved,
  onClose,
}: {
  expense?: ExpenseSummary;
  today: string;
  stale: boolean;
  onSaved: (date: string) => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const task = useWorkforceTask();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  return (
    <WorkforceDialog
      title={t(
        expense
          ? { ja: '経費の下書きを編集', en: 'Edit expense draft' }
          : { ja: '経費を記録', en: 'Record an expense' },
      )}
      description={t({
        ja: 'まず下書きに保存し、内容と証憑を確認してから提出します。金額は税込の精算額を1円単位で入力してください。',
        en: 'Save a draft, review the details and evidence, then submit. Enter the positive gross reimbursement amount in whole yen.',
      })}
      submitLabel={t({ ja: '下書きを保存', en: 'Save draft' })}
      stale={stale}
      onClose={onClose}
      onSubmit={async (data) => {
        await task.mutateAsync({
          action: 'workforce.save_expense',
          input: {
            ...(expense ? { expenseId: expense.id } : {}),
            expectedVersion: expense?.version ?? 0,
            idempotencyKey,
            expenseDate: formText(data, 'expenseDate'),
            category: formText(data, 'category'),
            description: formText(data, 'description'),
            amount: formText(data, 'amount'),
            evidence: formText(data, 'evidence'),
          },
        });
        onSaved(formText(data, 'expenseDate'));
      }}
    >
      <div className="workforce-form-row">
        <label>
          {t({ ja: '利用日', en: 'Expense date' })}
          <input
            className="input"
            name="expenseDate"
            type="date"
            required
            defaultValue={expense?.expenseDate ?? today}
          />
        </label>
        <label>
          {t({ ja: '経費の区分', en: 'Category' })}
          <input
            className="input"
            name="category"
            required
            maxLength={80}
            defaultValue={expense?.category ?? ''}
            placeholder={t({ ja: '交通費、消耗品など', en: 'Travel, supplies, etc.' })}
          />
        </label>
      </div>
      <label>
        {t({ ja: '精算する金額（円）', en: 'Reimbursement amount (JPY)' })}
        <input
          className="input"
          name="amount"
          inputMode="numeric"
          pattern="[1-9][0-9]*"
          required
          defaultValue={expense?.amount ?? ''}
        />
      </label>
      <label>
        {t({ ja: '利用目的・内容', en: 'Purpose and details' })}
        <textarea
          className="input"
          name="description"
          required
          maxLength={1000}
          rows={3}
          defaultValue={expense?.description ?? ''}
        />
      </label>
      <label>
        {t({ ja: '証憑の内容・保管場所', en: 'Evidence description and location' })}
        <textarea
          className="input"
          name="evidence"
          aria-label={t({ ja: '証憑の内容・保管場所', en: 'Evidence description and location' })}
          required
          maxLength={1000}
          rows={2}
          defaultValue={expense?.evidence ?? ''}
        />
        <small>
          {t({
            ja: '領収書の発行元・日付や、会社で確認できる保管先を記載します。',
            en: 'Describe the receipt issuer/date and where your company can verify it.',
          })}
        </small>
      </label>
    </WorkforceDialog>
  );
}

export function WorkforceExpenses({
  rows,
  today,
  actions,
  registered,
  onPeriod,
}: {
  rows: ExpenseSummary[];
  today: string;
  actions: string[];
  registered: boolean;
  onPeriod: (period: string) => void;
}) {
  const { t } = useLocale();
  const task = useWorkforceTask();
  const [receiptId, setReceiptId] = useState<string>();
  const receipt = rows.find((row) => row.id === receiptId);
  const [editor, setEditor] = useState<ExpenseSummary | 'new'>();
  const [cancel, setCancel] = useState<ExpenseSummary>();
  const [error, setError] = useState<unknown>();
  const submit = async (row: ExpenseSummary) => {
    setError(undefined);
    try {
      await task.mutateAsync({
        action: 'workforce.submit_expense',
        input: { expenseId: row.id, expectedVersion: row.version },
      });
    } catch (e) {
      setError(e);
    }
  };
  return (
    <WorkforcePanel
      title={t({ ja: '経費申請', en: 'Expenses' })}
      note={t({
        ja: '下書き → 提出 → 承認 → 精算。進み具合をここで確認。',
        en: 'Draft, submit, approve and reimburse. Follow each step here.',
      })}
      icon="wallet"
      actions={
        registered && actions.includes('workforce.save_expense') ? (
          <button type="button" className="btn btn-primary" onClick={() => setEditor('new')}>
            {t({ ja: '経費を記録', en: 'New expense' })}
          </button>
        ) : null
      }
    >
      {error ? <WorkforceError error={error} /> : null}
      {rows.length ? (
        <div className="workforce-record-list">
          {rows.map((row) => (
            <article className="workforce-record" key={row.id}>
              <header>
                <h3>
                  {row.expenseDate} · {row.category}
                </h3>
                <WorkforceStatus status={row.status} />
              </header>
              <div className="workforce-record-meta">
                <WorkforceMoney value={row.amount} />
              </div>
              <p>{row.description}</p>
              <p>
                {t({ ja: '証憑', en: 'Evidence' })}: {row.evidence}
              </p>
              {row.reviewReason ? (
                <p>
                  {t({ ja: '確認者から', en: 'Reviewer' })}: {row.reviewReason}
                </p>
              ) : null}
              {row.paidOn ? (
                <p>
                  {t({ ja: '精算日', en: 'Reimbursed on' })}: {row.paidOn} · {row.paymentReference}
                </p>
              ) : null}
              <div className="workforce-record-actions">
                <button type="button" className="btn" onClick={() => setReceiptId(row.id)}>
                  {t({ ja: '領収書・証憑', en: 'Receipts and evidence' })}
                </button>
                {['draft', 'returned'].includes(row.status) ? (
                  <>
                    {actions.includes('workforce.save_expense') ? (
                      <button type="button" className="btn" disabled={task.isPending} onClick={() => setEditor(row)}>
                        {t({ ja: '内容を編集', en: 'Edit details' })}
                      </button>
                    ) : null}
                    {actions.includes('workforce.submit_expense') ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={task.isPending}
                        onClick={() => void submit(row)}
                      >
                        {t({ ja: '経費を提出', en: 'Submit expense' })}
                      </button>
                    ) : null}
                  </>
                ) : null}
                {['draft', 'returned', 'submitted', 'approved'].includes(row.status) &&
                actions.includes('workforce.cancel_expense') ? (
                  <button type="button" className="btn" disabled={task.isPending} onClick={() => setCancel(row)}>
                    {t({ ja: '取り消す', en: 'Cancel' })}
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <WorkforceEmpty icon="wallet">
          {t({
            ja: 'この月の経費はまだありません。利用した経費を記録しましょう。',
            en: 'No expenses this month. Record a business expense to begin.',
          })}
        </WorkforceEmpty>
      )}
      {editor ? (
        <ExpenseForm
          {...(editor === 'new' ? {} : { expense: editor })}
          today={today}
          onSaved={(date) => onPeriod(date.slice(0, 7))}
          stale={editor !== 'new' && rows.find((r) => r.id === editor.id)?.version !== editor.version}
          onClose={() => setEditor(undefined)}
        />
      ) : null}
      {cancel ? (
        <WorkforceDialog
          title={t({ ja: '経費申請を取り消す', en: 'Cancel expense' })}
          description={cancel.description}
          submitLabel={t({ ja: '取消を確定', en: 'Confirm cancellation' })}
          onClose={() => setCancel(undefined)}
          stale={rows.find((r) => r.id === cancel.id)?.version !== cancel.version}
          onSubmit={async (data) => {
            await task.mutateAsync({
              action: 'workforce.cancel_expense',
              input: { expenseId: cancel.id, expectedVersion: cancel.version, reason: formText(data, 'reason') },
            });
          }}
        >
          <label>
            {t({ ja: '取り消す理由', en: 'Cancellation reason' })}
            <textarea className="input" name="reason" required maxLength={1000} rows={3} />
          </label>
        </WorkforceDialog>
      ) : null}
      {receipt ? (
        <WorkforceReceipts expense={receipt} canUpload={registered} onClose={() => setReceiptId(undefined)} />
      ) : null}
    </WorkforcePanel>
  );
}
