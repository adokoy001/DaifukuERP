// AC-4..7: /e/:entity/new and /e/:entity/:id — header (docstatus, number, actions, print view), form, attachments
// (phase1 AC-4), audit panel. ui-kit: the header is a PageHeader.
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useEntityMeta, useRecord } from '../api/queries.ts';
import type { EntityMeta, RecordJson } from '../api/types.ts';
import { useSubmitBlock } from '../components/allocation-picker.tsx';
import { AttachmentsPanel } from '../components/attachments-panel.tsx';
import { AuditPanel } from '../components/audit-panel.tsx';
import { DocActions } from '../components/doc-actions.tsx';
import { DocstatusBadge } from '../components/docstatus-badge.tsx';
import { PrintButton } from '../components/print-button.tsx';
import { RecordForm } from '../components/record-form.tsx';
import { WorkforceWorkflowLink } from '../components/workforce-workflow-link.tsx';
import { isWorkforceManaged } from '../lib/workforce-entity.ts';
import { useToast } from '../components/toast.tsx';
import { useLocale } from '../i18n.tsx';
import { formatTimestamp, shortId } from '../lib/format.ts';
import { S } from '../strings.ts';
import { EntityMissing, LoadingView, MetaError } from './status-views.tsx';
import { canRetainData } from '../lib/read-recovery.ts';
import { ReadRecoveryProvider, ReadRefreshNotice } from '../components/read-refresh-notice.tsx';
import { PageHeader } from '../ui/index.ts';
// document-links (C2): 複製 / quick actions, the seeded new-record notice, the 関連 panel.
import { RecordLinkActions, SeedNotice, useDraftSeed } from '../components/record-links.tsx';
import { RelatedPanel } from '../components/related-panel.tsx';
import type { DraftSeed } from '../lib/duplicate.ts';
import { useRecordVisit } from '../api/navigation-assist.ts';

function titleOf(entity: EntityMeta, record: RecordJson | undefined, fallback: string): string {
  if (!record) return fallback;
  const v = entity.displayField ? record[entity.displayField] : undefined;
  if (typeof v === 'string' && v) return v;
  if (typeof record.number === 'string' && record.number) return record.number;
  return shortId(record.id);
}

function SystemInfo({ record }: { record: RecordJson }) {
  const { t, locale } = useLocale();
  // Label in text-muted, value one step darker: both keep 4.5:1 on the canvas (text-subtle is decoration only).
  const item = (label: string, value: string) => (
    <span>
      <span>{label} </span>
      <span className="font-mono text-text-secondary">{value}</span>
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-text-muted">
      {item(t(S.id), record.id)}
      {item(t(S.version), String(record.version))}
      {item(t(S.createdAt), formatTimestamp(record.createdAt, locale))}
      {item(t(S.updatedAt), formatTimestamp(record.updatedAt, locale))}
      {record.amendedFrom ? item(t(S.amendedFrom), shortId(record.amendedFrom)) : null}
    </div>
  );
}

function RecordView({
  entity,
  record,
  seed,
}: {
  entity: EntityMeta;
  record: RecordJson | undefined;
  seed?: DraftSeed | undefined;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const submitBlocked = useSubmitBlock(entity, record);
  useRecordVisit(entity, record); // navigation-assist AC-3: recent records
  const [formStatus, setFormStatus] = useState({ dirty: false, saving: false });
  const [actionBusy, setActionBusy] = useState(false);
  const blocked = formStatus.saving
    ? t(S.saving)
    : formStatus.dirty
      ? t({ ja: '変更を保存してから操作してください', en: 'Save your changes before continuing' })
      : undefined;
  const toList = () => void navigate({ to: '/e/$entity', params: { entity: entity.name } });
  // A record created from a seed replaces the seeded /new entry, so Back does not reopen the prefilled form.
  const toRecord = (id: string) =>
    void navigate({
      to: '/e/$entity/$id',
      params: { entity: entity.name, id },
      replace: !record && seed !== undefined,
    });
  const onSaved = (rec: RecordJson, mode: 'create' | 'update') => {
    if (mode === 'create') {
      toast.success(t(S.created));
      toRecord(rec.id);
      return;
    }
    if (rec !== record) toast.success(t(S.saved));
  };
  return (
    <div className="flex flex-col gap-3 p-3">
      <ReadRefreshNotice />
      <PageHeader
        back={
          <Link to="/e/$entity" params={{ entity: entity.name }} className="ui-link w-max">
            ← {t(entity.label)}
          </Link>
        }
        title={titleOf(entity, record, t(S.new))}
        titleTestId="record-title"
        meta={
          entity.kind === 'document' && record ? (
            <>
              {record.number ? <span className="code text-text-secondary">{record.number}</span> : null}
              <DocstatusBadge docstatus={record.docstatus} />
            </>
          ) : null
        }
        actions={
          record ? (
            <>
              <PrintButton entity={entity} record={record} />
              <RecordLinkActions entity={entity} record={record} blocked={blocked} />
              <DocActions
                entity={entity}
                record={record}
                submitBlocked={submitBlocked}
                blocked={blocked}
                onBusy={setActionBusy}
                onAfter={(op, rec) => {
                  if (op === 'delete') toList();
                  else if (rec && rec.id !== record.id) toRecord(rec.id);
                }}
              />
            </>
          ) : null
        }
      />
      {record ? <SystemInfo record={record} /> : null}
      <WorkforceWorkflowLink entity={entity.name} />
      {!record && seed ? <SeedNotice seed={seed} /> : null}
      <RecordForm
        key={record?.id ?? `new:${seed?.key ?? ''}`}
        entity={entity}
        record={record}
        initial={seed}
        onSaved={onSaved}
        onCancel={toList}
        onStatus={setFormStatus}
        actionBusy={actionBusy}
      />
      {record ? <RelatedPanel entity={entity} id={record.id} version={record.version} /> : null}
      {record && !isWorkforceManaged(entity.name) ? <AttachmentsPanel entity={entity} id={record.id} /> : null}
      {record ? <AuditPanel entity={entity} id={record.id} /> : null}
    </div>
  );
}

export function EntityFormPage({ mode }: { mode: 'new' | 'edit' }) {
  const params = useParams({ strict: false }) as { entity?: string; id?: string };
  const name = params.entity ?? '';
  const id = mode === 'edit' ? params.id : undefined;
  const { meta, entity } = useEntityMeta(name);
  const record = useRecord(name, entity ? id : undefined);
  const seed = useDraftSeed(name);
  if (meta.isError && !canRetainData(meta)) return <MetaError error={meta.error} retry={() => void meta.refetch()} />;
  if (meta.isPending) return <LoadingView />;
  if (!entity) return <EntityMissing name={name} />;
  if (mode === 'new' && isWorkforceManaged(entity.name))
    return (
      <div className="p-3">
        <WorkforceWorkflowLink entity={entity.name} />
      </div>
    );
  if (mode === 'edit') {
    if (record.isError && !canRetainData(record))
      return <MetaError error={record.error} retry={() => void record.refetch()} />;
    if (record.isPending) return <LoadingView />;
    return (
      <ReadRecoveryProvider sources={[meta, record]}>
        <RecordView entity={entity} record={record.data} />
      </ReadRecoveryProvider>
    );
  }
  return (
    <ReadRecoveryProvider sources={[meta]}>
      <RecordView entity={entity} record={undefined} seed={seed} />
    </ReadRecoveryProvider>
  );
}
