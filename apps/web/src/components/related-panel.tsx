// document-links AC-4: the 「関連」 panel of a record page — GET /api/:entity/:id/related grouped by entity, each record a
// link to its page. It loads on its own (the form never waits for it); a failure stays inside the panel with a retry.
import { Link } from '@tanstack/react-router';
import { useMeta } from '../api/queries.ts';
import { useRelated, type RelatedGroup, type RelatedItem, type RelatedRelation } from '../api/related.ts';
import type { EntityMeta, Label } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { docstatusLabel, shortId } from '../lib/format.ts';
import { Badge, Button, Card, EmptyState, SkeletonCard, type BadgeTone } from '../ui/index.ts';

const RELATION: Record<RelatedRelation, Label> = {
  references: { ja: '参照先', en: 'Referenced' },
  referenced_by: { ja: '参照元', en: 'Refers to this' },
  amended_from: { ja: '訂正元', en: 'Amended from' },
  amendment: { ja: '訂正版', en: 'Amendment' },
};
const DOCSTATUS_TONE: Record<number, BadgeTone> = { 0: 'neutral', 1: 'success', 2: 'danger' };

/** Label of the linking field: `field` of the current entity, or `entity.field` of a line / referencing entity. */
function viaLabel(via: string, current: EntityMeta, entities: readonly EntityMeta[]): Label | undefined {
  const dot = via.indexOf('.');
  const owner = dot === -1 ? current : entities.find((e) => e.name === via.slice(0, dot));
  const field = dot === -1 ? via : via.slice(dot + 1);
  return owner?.fields.find((f) => f.name === field)?.label;
}

function ItemRow({ group, item, entity }: { group: RelatedGroup; item: RelatedItem; entity: EntityMeta }) {
  const { t } = useLocale();
  const meta = useMeta();
  const via = viaLabel(item.via, entity, meta.data?.entities ?? []);
  const name = item.number ?? item.title ?? shortId(item.id);
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" data-testid="related-item" data-id={item.id}>
      <Link to="/e/$entity/$id" params={{ entity: group.entity, id: item.id }} className="ui-link break-all">
        {name}
      </Link>
      {item.number && item.title ? <span className="text-text-secondary">{item.title}</span> : null}
      {item.docstatus !== null ? (
        <Badge tone={DOCSTATUS_TONE[item.docstatus] ?? 'neutral'} data-testid="related-docstatus">
          {t(docstatusLabel(item.docstatus))}
        </Badge>
      ) : null}
      {item.date ? <span className="font-mono text-text-muted">{item.date}</span> : null}
      <span className="text-text-muted" data-relation={item.relation}>
        {t(RELATION[item.relation])}
        {via ? ` · ${t(via)}` : null}
      </span>
    </li>
  );
}

function GroupSection({ group, entity }: { group: RelatedGroup; entity: EntityMeta }) {
  const { t } = useLocale();
  const headingId = `related-${group.entity}`;
  return (
    <section aria-labelledby={headingId} data-testid={`related-group-${group.entity}`} className="flex flex-col gap-1">
      <h3 id={headingId} className="flex items-baseline gap-2 text-xs font-semibold text-text">
        {t(group.label)}
        <Badge data-testid="related-count">
          {group.items.length}
          {group.more ? '+' : ''}
        </Badge>
      </h3>
      <ul className="flex flex-col gap-1 text-xs">
        {group.items.map((item) => (
          <ItemRow key={item.id} group={group} item={item} entity={entity} />
        ))}
      </ul>
      {group.more ? (
        <p className="text-xs text-text-muted">
          {t({ ja: '最初の 50 件を表示しています。', en: 'Showing the first 50 records.' })}
        </p>
      ) : null}
    </section>
  );
}

export function RelatedPanel({ entity, id }: { entity: EntityMeta; id: string }) {
  const { t } = useLocale();
  const related = useRelated(entity.name, id);
  const title = t({ ja: '関連', en: 'Related' });
  // Documents (payments, journal entries, amendments) before master records; server order within each kind.
  const groups = [...(related.data?.groups ?? [])].sort(
    (a, b) => Number(b.kind === 'document') - Number(a.kind === 'document'),
  );
  return (
    <Card aria-labelledby="related-panel-title" data-testid="related-panel">
      <div className="ui-section-head">
        <h2 id="related-panel-title" className="ui-section-title">
          {title}
        </h2>
        {related.data ? (
          <span className="text-xs text-text-muted" data-testid="related-total">
            {t({ ja: `${groups.length} 種類`, en: `${groups.length} kinds` })}
          </span>
        ) : null}
      </div>
      {related.isPending ? (
        <>
          <span className="sr-only" aria-live="polite">
            {t({ ja: '関連する記録を読み込み中…', en: 'Loading related records…' })}
          </span>
          <div aria-busy="true">
            <SkeletonCard lines={3} />
          </div>
        </>
      ) : null}
      {related.isError ? (
        <div
          className="ui-notice ui-notice-danger flex flex-wrap items-center gap-2 text-xs"
          data-testid="related-error"
        >
          <span className="flex-1">
            {t({ ja: '関連する記録を読み込めませんでした。', en: 'Related records could not be loaded.' })}
          </span>
          <Button size="sm" onClick={() => void related.refetch()}>
            {t({ ja: '再試行', en: 'Retry' })}
          </Button>
        </div>
      ) : null}
      {related.data && groups.length === 0 ? (
        <EmptyState
          testId="related-empty"
          title={t({ ja: '関連する記録はありません', en: 'No related records' })}
          description={t({
            ja: '読み取りできる記録だけを表示します。',
            en: 'Only records you can read are shown.',
          })}
        />
      ) : null}
      {groups.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {groups.map((group) => (
            <GroupSection key={group.entity} group={group} entity={entity} />
          ))}
        </div>
      ) : null}
    </Card>
  );
}
