// document-links AC-1/AC-5/AC-7: 複製 and quick actions on a record page, and the notice above a seeded new-record form.
// Both re-read the source record first: a failed read or a changed version opens nothing and says why (AC-7). The
// new-record page receives the values through router history state (lib/duplicate.ts); nothing is created until saved.
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { isApiError } from '../api/client.ts';
import { keys, useMeta } from '../api/queries.ts';
import { fetchFreshRecord } from '../api/related.ts';
import type { EntityMeta, RecordJson } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { duplicateSeed, seedFromState, seedState, todayLocal, type DraftSeed } from '../lib/duplicate.ts';
import { shortId } from '../lib/format.ts';
import { quickActionSeed, quickActionsFor } from '../lib/quick-actions.ts';
import { isWorkforceManaged } from '../lib/workforce-entity.ts';
import { Button } from '../ui/index.ts';
import { useToast } from './toast.tsx';

/** Number, display value or short id: how a record is named in notices and links. */
export function recordTitle(entity: EntityMeta, record: RecordJson): string {
  if (typeof record.number === 'string' && record.number) return record.number;
  const v = entity.displayField ? record[entity.displayField] : undefined;
  if (typeof v === 'string' && v) return v;
  return shortId(record.id);
}

/** The draft seed in the current location's history state, when it is meant for `entity`'s new-record page. */
export function useDraftSeed(entity: string): DraftSeed | undefined {
  const state = useRouterState({ select: (s) => s.location.state });
  return useMemo(() => seedFromState(state, entity), [state, entity]);
}

export interface RecordLinkActionsProps {
  entity: EntityMeta;
  record: RecordJson;
  /** Why actions are unavailable right now (unsaved changes, saving); disables the buttons. */
  blocked?: string | undefined;
}

/** 複製 (AC-1) and the declared quick actions (AC-5/AC-6) for one record. */
export function RecordLinkActions({ entity, record, blocked }: RecordLinkActionsProps) {
  const { t } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const meta = useMeta();
  const [busy, setBusy] = useState<string | null>(null);
  const entities = meta.data?.entities ?? [];
  const canDuplicate = entity.ops.includes('create') && !isWorkforceManaged(entity.name);
  const quick = quickActionsFor(entity, record, entities);
  if (!canDuplicate && quick.length === 0) return null;

  /** AC-7: the record as the server has it now, or undefined after telling the user why nothing opens. */
  const reread = async (): Promise<RecordJson | undefined> => {
    let fresh: RecordJson;
    try {
      fresh = await fetchFreshRecord(entity.name, record.id);
    } catch (e) {
      toast.push({
        kind: 'error',
        title: t({
          ja: '元の記録を読み直せないため、新規画面を開きませんでした',
          en: 'The source record could not be re-read, so no new record was opened',
        }),
        ...(isApiError(e) ? { message: e.message, code: e.code } : { message: String(e) }),
      });
      return undefined;
    }
    if (fresh.version === record.version) return fresh;
    await qc.invalidateQueries({ queryKey: keys.record(entity.name, record.id) });
    toast.push({
      kind: 'error',
      title: t({ ja: 'この記録は表示した後に更新されました', en: 'This record changed after it was shown' }),
      message: t({
        ja: '最新の内容を読み込みました。確認してからもう一度操作してください。',
        en: 'The latest version has been loaded. Check it and try again.',
      }),
    });
    return undefined;
  };

  const launch = async (id: string, build: (fresh: RecordJson) => DraftSeed) => {
    if (busy !== null) return;
    setBusy(id);
    try {
      const fresh = await reread();
      if (!fresh) return;
      const seed = build(fresh);
      await navigate({
        to: '/e/$entity/new',
        params: { entity: seed.entity },
        state: (prev) => ({ ...prev, ...seedState(seed) }),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="record-links">
      {quick.map((action) => (
        <Button
          key={action.id}
          data-testid={`quick-action-${action.id}`}
          disabled={busy !== null || blocked !== undefined}
          title={blocked}
          onClick={() =>
            void launch(action.id, (fresh) => quickActionSeed(action, fresh, todayLocal(), recordTitle(entity, fresh)))
          }
        >
          {t(action.label)}
        </Button>
      ))}
      {canDuplicate ? (
        <Button
          data-testid="duplicate-record"
          disabled={busy !== null || blocked !== undefined}
          title={blocked}
          onClick={() =>
            void launch('duplicate', (fresh) =>
              duplicateSeed(entity, fresh, entities, todayLocal(), recordTitle(entity, fresh)),
            )
          }
        >
          {t({ ja: '複製', en: 'Duplicate' })}
        </Button>
      ) : null}
    </div>
  );
}

/** Above a seeded new-record form: where the values came from (with a link) and that nothing exists until saved. */
export function SeedNotice({ seed }: { seed: DraftSeed }) {
  const { t } = useLocale();
  const meta = useMeta();
  const sourceEntity = meta.data?.entities.find((e) => e.name === seed.source.entity);
  const sourceLabel = sourceEntity ? t(sourceEntity.label) : seed.source.entity;
  const link = (
    <Link
      to="/e/$entity/$id"
      params={{ entity: seed.source.entity, id: seed.source.id }}
      className="ui-link"
      data-testid="seed-source"
    >
      {seed.source.title}
    </Link>
  );
  return (
    <div className="ui-notice ui-notice-info text-xs" data-testid="seed-notice" data-mode={seed.source.mode}>
      <p>
        {seed.source.mode === 'duplicate' ? (
          <>
            {t({ ja: '複製元: ', en: 'Copied from ' })}
            {sourceLabel} {link}
            {seed.source.date
              ? t({ ja: `（元の日付 ${seed.source.date}）`, en: ` (original date ${seed.source.date})` })
              : null}
          </>
        ) : (
          <>
            {t({ ja: '元の記録: ', en: 'From ' })}
            {sourceLabel} {link}
          </>
        )}
      </p>
      <p>
        {t({
          ja: '初期値を入れました。保存するまで記録は作成されません。',
          en: 'Initial values are filled in. Nothing is created until you save.',
        })}
      </p>
    </div>
  );
}
