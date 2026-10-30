// The supersede history of one piece of evidence (docs/specs/evidence-search.md AC-16): attachment.history in a kit
// Dialog, latest version first; every version downloads through the existing route. The actor is shown as in the audit
// panel (`actorType:short id`), since most roles cannot read the user directory. Closing returns focus to the opener
// (the kit Dialog does that).
import { downloadAttachment } from '../api/attachments.ts';
import { useEvidenceHistory } from '../api/evidence.ts';
import type { FieldMeta } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { describeError } from '../lib/error-view.ts';
import { RELATION_LABELS, type HistoryItem, type HistoryRelation } from '../lib/evidence-search.ts';
import { formatTimestamp, formatValue, shortId } from '../lib/format.ts';
import { S } from '../strings.ts';
import { Badge, Button, Dialog, SkeletonCard, type BadgeTone } from '../ui/index.ts';
import { ErrorDetails } from './error-details.tsx';
import { useToast } from './toast.tsx';

const RELATION_TONE: Record<HistoryRelation, BadgeTone> = {
  self: 'accent',
  newer: 'success',
  older: 'neutral',
  sibling: 'warning',
};

function Version({
  item,
  amountField,
  currencyScale,
}: {
  item: HistoryItem;
  amountField: FieldMeta | undefined;
  currencyScale: number;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const amount = item.amount === null ? '—' : formatValue(amountField, item.amount, locale, { currencyScale }).text;
  const record = item.supersede;
  return (
    <li
      className="flex flex-col gap-1 border-b border-border-subtle py-2 last:border-b-0"
      data-testid="evidence-version"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={RELATION_TONE[item.relation]} data-testid="evidence-version-relation">
          {t(RELATION_LABELS[item.relation])}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          className="max-w-full truncate"
          onClick={() => void downloadAttachment(item).catch((error: unknown) => toast.error(error))}
          aria-label={t({ ja: `${item.filename} をダウンロード`, en: `Download ${item.filename}` })}
        >
          {item.filename}
        </Button>
      </div>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs text-text-secondary">
        <dt>{t({ ja: '取引年月日', en: 'Transaction date' })}</dt>
        <dd className="font-mono">{item.txnDate ?? '—'}</dd>
        <dt>{t({ ja: '取引金額', en: 'Amount' })}</dt>
        <dd className="font-mono">{amount}</dd>
        <dt>{t({ ja: '登録日時', en: 'Registered' })}</dt>
        <dd className="font-mono">{formatTimestamp(item.createdAt, locale)}</dd>
        {record ? (
          <>
            <dt>{t({ ja: '差替の理由', en: 'Reason' })}</dt>
            <dd data-testid="evidence-version-reason">{record.reason ?? t({ ja: '記録なし', en: 'Not recorded' })}</dd>
            <dt>{t({ ja: '差替の日時', en: 'Superseded at' })}</dt>
            <dd className="font-mono">
              {record.at ? formatTimestamp(record.at, locale) : t({ ja: '記録なし', en: 'Not recorded' })}
            </dd>
            <dt>{t({ ja: '実行者', en: 'By' })}</dt>
            <dd className="font-mono">
              {record.actorType && record.actorId
                ? `${record.actorType}:${shortId(record.actorId)}`
                : t({ ja: '記録なし', en: 'Not recorded' })}
            </dd>
          </>
        ) : null}
      </dl>
    </li>
  );
}

export function EvidenceHistoryDialog({
  id,
  filename,
  amountField,
  currencyScale,
  onClose,
}: {
  id: string;
  filename: string;
  amountField: FieldMeta | undefined;
  currencyScale: number;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const history = useEvidenceHistory(id);
  const view = history.isError ? describeError(history.error) : undefined;
  return (
    <Dialog
      title={t({ ja: `差替の履歴: ${filename}`, en: `Supersede history: ${filename}` })}
      description={t({
        ja: '差し替えられた版も削除されずに保存されており、それぞれダウンロードできます（訂正削除履歴）。新しい版から順に表示します。',
        en: 'Superseded versions are kept, never deleted, and each can be downloaded (correction history). Newest first.',
      })}
      onClose={onClose}
      closeLabel={t(S.close)}
      className="evidence-history-dialog"
      actions={
        <Button data-autofocus onClick={onClose}>
          {t(S.close)}
        </Button>
      }
    >
      <div data-testid="evidence-history" aria-busy={history.isPending}>
        {history.isPending ? (
          <SkeletonCard lines={4} />
        ) : view ? (
          <div className="ui-notice ui-notice-danger flex flex-col gap-1" role="alert">
            <p>{view.explanation ? t(view.explanation) : view.message}</p>
            <ErrorDetails view={view} />
            <Button size="sm" onClick={() => void history.refetch()}>
              {t(S.retry)}
            </Button>
          </div>
        ) : (
          <>
            <ol className="flex flex-col">
              {history.data?.items.map((item) => (
                <Version key={item.id} item={item} amountField={amountField} currencyScale={currencyScale} />
              ))}
            </ol>
            {history.data?.truncated ? (
              <p className="ui-notice ui-notice-info text-xs" data-testid="evidence-history-truncated">
                {t({
                  ja: '版が多いため一部だけを表示しています（この証憑から最新版までの版は必ず表示します）。残りは証憑の一覧（/e/attachment）で確認してください。',
                  en: 'Only part of the history is shown (the versions from this evidence to the latest are always included). Find the rest in the attachment list (/e/attachment).',
                })}
              </p>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}
