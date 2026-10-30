// list-workbench AC-10/AC-11: bulk submit / cancel / delete on the generic document list. Each row goes through the
// existing REST document operation with the version the list showed; a failure is reported for its row and never
// rolls back the rows that succeeded. One run at a time; the list is read again when it ends.
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCallback, useRef, useState, type Ref } from 'react';
import { request } from '../api/client.ts';
import { keys } from '../api/queries.ts';
import type { EntityMeta, Label, RecordJson } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { toastFromError } from '../lib/error-view.ts';
import {
  BULK_LIMIT,
  bulkRequest,
  bulkSummary,
  countLabel,
  planBulk,
  rowLabel,
  ROWS,
  type BulkOp,
  type BulkRowResult,
} from '../lib/list-workbench.ts';
import { S } from '../strings.ts';
import { Badge, Button, Card, Dialog } from '../ui/index.ts';

const OP_LABEL: Record<BulkOp, Label> = {
  submit: { ja: '確定', en: 'Submit' },
  cancel: { ja: '取消', en: 'Cancel' },
  delete: { ja: '削除', en: 'Delete' },
};
/** Why a selected row is left out of an operation. */
const STATE_NOTE: Record<BulkOp, Label> = {
  submit: { ja: '下書きでない', en: 'not a draft' },
  cancel: { ja: '確定済みでない', en: 'not submitted' },
  delete: { ja: '下書きでない', en: 'not a draft' },
};

function count(n: number, locale: 'ja' | 'en'): string {
  return countLabel(n, locale, ROWS);
}

export interface BulkRun {
  op: BulkOp;
  results: BulkRowResult[];
  active: boolean;
}

/** AC-11: runs one bulk operation at a time (a second start while running is ignored), then refreshes the list. */
export function useBulkRunner(entity: EntityMeta) {
  const qc = useQueryClient();
  const { t } = useLocale();
  const [run, setRun] = useState<BulkRun | null>(null);
  const running = useRef(false);
  const start = useCallback(
    async (op: BulkOp, targets: readonly RecordJson[]) => {
      if (running.current || targets.length === 0) return false;
      running.current = true;
      const rows = targets.slice(0, BULK_LIMIT);
      const update = (index: number, patch: Partial<BulkRowResult>) =>
        setRun((current) =>
          current
            ? { ...current, results: current.results.map((r, i) => (i === index ? { ...r, ...patch } : r)) }
            : current,
        );
      setRun({
        op,
        active: true,
        results: rows.map((row) => ({ id: row.id, label: rowLabel(entity, row), status: 'pending' })),
      });
      try {
        for (const [index, row] of rows.entries()) {
          update(index, { status: 'running' });
          const call = bulkRequest(entity.name, op, row);
          try {
            await request<unknown>(call.path, { method: call.method, body: call.body });
            update(index, { status: 'done' });
          } catch (error) {
            const view = toastFromError(error, t({ ja: '失敗しました', en: 'Failed' }));
            update(index, {
              status: 'failed',
              message: [view.title, view.message, view.code].filter(Boolean).join(' · '),
            });
          }
        }
      } finally {
        running.current = false;
        setRun((current) => (current ? { ...current, active: false } : current));
        await qc.invalidateQueries({ queryKey: keys.list(entity.name) });
        await qc.invalidateQueries({ queryKey: ['record', entity.name] });
      }
      return true;
    },
    [entity, qc, t],
  );
  return { run, start, clear: () => setRun((current) => (current?.active ? current : null)) };
}

interface BarProps {
  ops: readonly BulkOp[];
  selected: readonly RecordJson[];
  busy: boolean;
  onChoose: (op: BulkOp) => void;
  onClear: () => void;
}

/** Shown while rows are selected: the count, one button per allowed operation with its eligible count, and why rows are left out. */
export function BulkBar({ ops, selected, busy, onChoose, onClear }: BarProps) {
  const { t, locale } = useLocale();
  const plans = ops.map((op) => ({ op, plan: planBulk(op, selected) }));
  const notes = plans
    .filter(({ plan }) => plan.ineligible.length > 0)
    .map(({ op, plan }) =>
      locale === 'ja'
        ? `${t(OP_LABEL[op])}: ${plan.ineligible.length} 件は${t(STATE_NOTE[op])}ため対象外`
        : `${t(OP_LABEL[op])}: ${count(plan.ineligible.length, locale)} left out (${t(STATE_NOTE[op])})`,
    );
  return (
    <div className="ui-notice ui-notice-info flex flex-col gap-1.5" data-testid="bulk-bar">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold" data-testid="bulk-count">
          {locale === 'ja'
            ? `${selected.length} 件を選択中（1 回 ${BULK_LIMIT} 件まで）`
            : `${count(selected.length, locale)} selected (up to ${BULK_LIMIT} per run)`}
        </span>
        {plans.map(({ op, plan }) => (
          <Button
            key={op}
            size="sm"
            variant={op === 'delete' ? 'danger' : 'default'}
            disabled={busy || plan.targets.length === 0}
            onClick={() => onChoose(op)}
          >
            {locale === 'ja'
              ? `${t(OP_LABEL[op])}（${plan.targets.length}）`
              : `${t(OP_LABEL[op])} (${plan.targets.length})`}
          </Button>
        ))}
        <Button size="sm" variant="ghost" disabled={busy} onClick={onClear}>
          {t({ ja: '選択を解除', en: 'Clear selection' })}
        </Button>
      </div>
      {notes.length ? (
        <ul className="text-xs" data-testid="bulk-ineligible">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface ConfirmProps {
  entity: EntityMeta;
  op: BulkOp;
  selected: readonly RecordJson[];
  onConfirm: () => void;
  onClose: () => void;
}

export function BulkConfirm({ entity, op, selected, onConfirm, onClose }: ConfirmProps) {
  const { t, locale } = useLocale();
  const plan = planBulk(op, selected);
  const shown = plan.targets.slice(0, 10);
  const title =
    locale === 'ja'
      ? `${plan.targets.length} 件を${t(OP_LABEL[op])}`
      : `${t(OP_LABEL[op])} ${count(plan.targets.length, locale)}`;
  return (
    <Dialog
      title={title}
      description={t({
        ja: '1 件ずつ順に実行します。失敗した行があっても、成功した行は元に戻りません。結果は行ごとに表示します。',
        en: 'Rows are processed one by one. A failed row does not undo the rows that succeeded; results are shown per row.',
      })}
      closeLabel={t(S.close)}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm();
      }}
      actions={
        <>
          <Button onClick={onClose} data-autofocus>
            {t({ ja: '戻る', en: 'Go back' })}
          </Button>
          <Button type="submit" variant={op === 'delete' ? 'danger' : 'primary'}>
            {title}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-0.5 text-sm" data-testid="bulk-targets">
        {shown.map((row) => (
          <li key={row.id} className="font-mono">
            {rowLabel(entity, row)}
          </li>
        ))}
        {plan.targets.length > shown.length ? (
          <li>
            {locale === 'ja'
              ? `ほか ${plan.targets.length - shown.length} 件`
              : `and ${plan.targets.length - shown.length} more`}
          </li>
        ) : null}
      </ul>
      {plan.ineligible.length ? (
        <p data-testid="bulk-left-out">
          {locale === 'ja'
            ? `選択した ${plan.ineligible.length} 件は${t(STATE_NOTE[op])}ため対象外です。`
            : `${count(plan.ineligible.length, locale)} of the selection are left out (${t(STATE_NOTE[op])}).`}
        </p>
      ) : null}
    </Dialog>
  );
}

const STATUS_TONE = { pending: 'neutral', running: 'accent', done: 'success', failed: 'danger' } as const;
const STATUS_LABEL: Record<BulkRowResult['status'], Label> = {
  pending: { ja: '待機中', en: 'Waiting' },
  running: { ja: '実行中', en: 'Running' },
  done: { ja: '成功', en: 'Done' },
  failed: { ja: '失敗', en: 'Failed' },
};

/**
 * Per-row results of the last run; kept after the list refresh until closed. The heading takes focus when a run starts
 * (`headingRef`, tabIndex -1): the confirm dialog's opener, the bulk bar, is gone by then.
 */
export function BulkResults({
  entity,
  run,
  onClose,
  headingRef,
}: {
  entity: EntityMeta;
  run: BulkRun;
  onClose: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const { t, locale } = useLocale();
  const summary = bulkSummary(run.results);
  const heading = locale === 'ja' ? `一括${t(OP_LABEL[run.op])}の結果` : `Bulk ${t(OP_LABEL[run.op]).toLowerCase()}`;
  const line =
    locale === 'ja'
      ? `成功 ${summary.done} 件・失敗 ${summary.failed} 件${run.active ? `・残り ${summary.pending} 件` : ''}`
      : `${summary.done} done, ${summary.failed} failed${run.active ? `, ${summary.pending} remaining` : ''}`;
  return (
    <Card className="gap-1.5" data-testid="bulk-results">
      <div className="flex flex-wrap items-center gap-2">
        <h2 ref={headingRef} tabIndex={-1} className="text-sm font-semibold text-text" data-testid="bulk-heading">
          {heading}
        </h2>
        <div aria-live="polite" className="text-xs text-text-secondary" data-testid="bulk-summary">
          {run.active ? `${t({ ja: '実行中', en: 'Running' })} — ${line}` : line}
        </div>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={run.active} onClick={onClose}>
          {t(S.close)}
        </Button>
      </div>
      <ul className="flex max-h-48 flex-col gap-1 overflow-auto text-sm">
        {run.results.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2" data-result={r.status} data-id={r.id}>
            <Badge tone={STATUS_TONE[r.status]}>{t(STATUS_LABEL[r.status])}</Badge>
            {r.status === 'done' && run.op === 'delete' ? (
              <span className="font-mono">{r.label}</span>
            ) : (
              <Link to="/e/$entity/$id" params={{ entity: entity.name, id: r.id }} className="ui-link font-mono">
                {r.label}
              </Link>
            )}
            {r.message ? <span className="text-xs text-danger-text">{r.message}</span> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
