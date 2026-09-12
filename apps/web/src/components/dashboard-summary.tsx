import { Link } from '@tanstack/react-router';
import type { CountCell } from '../api/dashboard.ts';
import type { Docstatus, EntityMeta } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { groupDigits } from '../lib/format.ts';
import { Icon, type IconName } from './icon.tsx';

export type CountLookup = (entity: string, ds: Docstatus) => CountCell;
export function CountValue({ cell }: { cell: CountCell }) {
  const { t } = useLocale();
  if (cell.error) return <span title={t({ ja: '取得できませんでした', en: 'Count unavailable' })}>—</span>;
  return <>{cell.total === undefined ? '…' : groupDigits(String(cell.total))}</>;
}
function total(documents: EntityMeta[], count: CountLookup, status: Docstatus): CountCell {
  const cells = documents.map((e) => count(e.name, status));
  const complete = cells.every((c) => c.total !== undefined);
  return { error: cells.some((c) => c.error), total: complete ? cells.reduce((n, c) => n + (c.total ?? 0), 0) : undefined };
}

export function DashboardSummary({ documents, count, reportCount }: { documents: EntityMeta[]; count: CountLookup; reportCount: number }) {
  const { t } = useLocale();
  const cards: { label: { ja: string; en: string }; hint: { ja: string; en: string }; value: CountCell; icon: IconName; color: string }[] = [
    { label: { ja: '作業中の伝票', en: 'In progress' }, hint: { ja: '下書きを確認して次のステップへ', en: 'Review drafts for the next step' }, value: total(documents, count, 0), icon: 'clock', color: 'violet' },
    { label: { ja: '確定済みの伝票', en: 'Submitted' }, hint: { ja: '記録された業務をいつでも確認', en: 'Your recorded business activity' }, value: total(documents, count, 1), icon: 'check', color: 'cyan' },
    { label: { ja: '使えるレポート', en: 'Reports' }, hint: { ja: '数字から、業務の状況をつかむ', en: 'Explore your business in numbers' }, value: { total: reportCount, error: false }, icon: 'chart', color: 'coral' },
  ];
  return <section className="summary-grid" aria-label={t({ ja: 'ワークスペースの概況', en: 'Workspace overview' })}>
    {cards.map((card) => <article className={`summary-card tone-${card.color}`} key={card.color}>
      <div className="summary-top"><span>{t(card.label)}</span><span className="icon-tile"><Icon name={card.icon} /></span></div>
      <div className="summary-value"><CountValue cell={card.value} /><small>{t({ ja: card.color === 'coral' ? '種類' : '件', en: card.color === 'coral' ? 'available' : 'documents' })}</small></div>
      <p>{t(card.hint)}</p>
    </article>)}
  </section>;
}

export function QuickStart({ documents }: { documents: EntityMeta[] }) {
  const { t } = useLocale();
  const writable = documents.filter((e) => e.ops.includes('create')).slice(0, 4);
  if (!writable.length) return null;
  return <section className="quick-start" aria-label={t({ ja: 'すぐに始める', en: 'Quick start' })}>
    <div><span className="eyebrow">{t({ ja: 'さあ、始めましょう', en: 'MAKE YOUR NEXT MOVE' })}</span><h2>{t({ ja: '新しい記録をつくる', en: 'Create a new record' })}</h2></div>
    <div className="quick-actions">{writable.map((e) => <Link key={e.name} to="/e/$entity/new" params={{ entity: e.name }}><Icon name="plus" size={17} />{t(e.label)}</Link>)}</div>
  </section>;
}
