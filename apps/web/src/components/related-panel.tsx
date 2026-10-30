// document-links AC-4: the 「関連」 panel of a record page — GET /api/:entity/:id/related grouped by entity, each record a
// link to its page. It loads on its own (the form never waits for it); a failure stays inside the panel with the
// technical details folded away and a retry. One always-mounted polite live region announces loading and failure.
import { Link } from '@tanstack/react-router';
import { useRef } from 'react';
import { useMeta } from '../api/queries.ts';
import { useRelated, type RelatedGroup, type RelatedItem, type RelatedRelation } from '../api/related.ts';
import type { EntityMeta, Label } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { describeError } from '../lib/error-view.ts';
import { shortId } from '../lib/format.ts';
import { S } from '../strings.ts';
import { Badge, Button, Card, EmptyState, SkeletonCard } from '../ui/index.ts';
import { DocstatusBadge } from './docstatus-badge.tsx';

const RELATION: Record<RelatedRelation, Label> = {
  references: { ja: '参照先', en: 'Linked from this' },
  referenced_by: { ja: '参照元', en: 'Links to this' },
  amended_from: { ja: '訂正元', en: 'Amended from' },
  amendment: { ja: '訂正版', en: 'Amendment' },
};
const LOADING: Label = { ja: '関連する記録を読み込み中…', en: 'Loading related records…' };
const FAILED: Label = { ja: '関連する記録を読み込めませんでした。', en: 'Related records could not be loaded.' };

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
      {item.docstatus !== null ? <DocstatusBadge docstatus={item.docstatus} testId="related-docstatus" /> : null}
      {item.date ? <span className="font-mono text-text-muted">{item.date}</span> : null}
      <span className="text-text-muted" data-relation={item.relation}>
        {t(RELATION[item.relation])}
        {via ? ` · ${t(via)}` : null}
      </span>
    </li>
  );
}

/** One entity's records. A plain block under its h3 (not a region landmark of its own). */
function GroupBlock({ group, entity }: { group: RelatedGroup; entity: EntityMeta }) {
  const { t } = useLocale();
  return (
    <div data-testid={`related-group-${group.entity}`} data-kind={group.kind} className="flex flex-col gap-1">
      <h3 className="flex items-baseline gap-2 text-xs font-semibold text-text">
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
    </div>
  );
}

/** The failure in plain words, then the server message, code, HTTP status and hint folded away (ui.md 状態表示の決まり). */
function RelatedError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useLocale();
  const view = describeError(error);
  return (
    <div className="ui-notice ui-notice-danger flex flex-col items-start gap-1 text-xs" data-testid="related-error">
      <p>
        {t(FAILED)}
        {view.explanation ? ` ${t(view.explanation)}` : null}
      </p>
      <details className="ui-error-details" data-testid="related-error-details">
        <summary>{t(S.technicalDetails)}</summary>
        <p className="ui-error-message">{view.message}</p>
        {view.code !== undefined || view.status !== undefined || view.hint !== undefined ? (
          <dl>
            {view.code ? (
              <>
                <dt>{t(S.errorCode)}</dt>
                <dd className="code">{view.code}</dd>
              </>
            ) : null}
            {view.status !== undefined ? (
              <>
                <dt>HTTP</dt>
                <dd className="code">{view.status === 0 ? t(S.noResponse) : view.status}</dd>
              </>
            ) : null}
            {view.hint ? (
              <>
                <dt>{t(S.errorHint)}</dt>
                <dd>{view.hint}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
      </details>
      <Button size="sm" onClick={onRetry}>
        {t(S.retry)}
      </Button>
    </div>
  );
}

export function RelatedPanel({ entity, id, version }: { entity: EntityMeta; id: string; version: number }) {
  const { t } = useLocale();
  const related = useRelated(entity.name, id, version);
  const heading = useRef<HTMLHeadingElement>(null);
  const title = t({ ja: '関連', en: 'Related' });
  // Documents (payments, journal entries, amendments) before master records; server order within each kind.
  const groups = [...(related.data?.groups ?? [])].sort(
    (a, b) => Number(b.kind === 'document') - Number(a.kind === 'document'),
  );
  // Retry removes the pressed button (the panel goes back to loading): keep focus in the panel, on its heading.
  const retry = () => {
    heading.current?.focus();
    void related.refetch();
  };
  const announcement = related.isPending ? t(LOADING) : related.isError ? t(FAILED) : '';
  return (
    <Card aria-labelledby="related-panel-title" data-testid="related-panel">
      <div className="ui-section-head">
        <h2 id="related-panel-title" ref={heading} tabIndex={-1} className="ui-section-title">
          {title}
        </h2>
        {related.data ? (
          <span className="text-xs text-text-muted" data-testid="related-total">
            {t({
              ja: `${groups.length} 種類`,
              en: groups.length === 1 ? '1 type' : `${groups.length} types`,
            })}
          </span>
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite" data-testid="related-status">
        {announcement}
      </p>
      {related.isPending ? (
        <div aria-busy="true">
          <SkeletonCard lines={3} />
        </div>
      ) : null}
      {related.isError ? <RelatedError error={related.error} onRetry={retry} /> : null}
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
            <GroupBlock key={group.entity} group={group} entity={entity} />
          ))}
        </div>
      ) : null}
    </Card>
  );
}
