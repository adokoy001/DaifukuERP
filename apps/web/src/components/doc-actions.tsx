import { useEffect, useRef, useState } from 'react';
import { useDelete, useDocAction, type DocOp } from '../api/queries.ts';
import type { EntityMeta, RecordJson } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { S } from '../strings.ts';
import { ActionConfirm } from './action-confirm.tsx';
import { useToast } from './toast.tsx';

export interface DocActionsProps {
  entity: EntityMeta;
  record: RecordJson;
  onAfter: (op: DocOp | 'delete', result: RecordJson | undefined) => void;
  submitBlocked?: string | undefined;
  blocked?: string | undefined;
  onBusy?: (busy: boolean) => void;
}
type Choice = { op: DocOp | 'delete'; title: string; message: string; done: string };

export function DocActions({ entity, record, onAfter, submitBlocked, blocked, onBusy }: DocActionsProps) {
  const { t } = useLocale();
  const toast = useToast();
  const act = useDocAction({ entity: entity.name });
  const del = useDelete({ entity: entity.name });
  const [choice, setChoice] = useState<Choice | null>(null);
  const inFlight = useRef(false);
  const ds = record.docstatus ?? 0;
  const isDoc = entity.kind === 'document';
  const pending = act.isPending || del.isPending;
  const busy = pending || blocked !== undefined;
  useEffect(() => { onBusy?.(pending); }, [pending, onBusy]);
  const execute = (correctionDate?: string) => {
    if (!choice || busy || inFlight.current || (choice.op === 'submit' && submitBlocked)) return;
    inFlight.current = true;
    setChoice(null);
    const settled = () => { inFlight.current = false; };
    const fail = (e: unknown) => toast.error(e);
    if (choice.op === 'delete') {
      del.mutate({ id: record.id, expectedVersion: record.version }, { onSuccess: () => { toast.success(choice.done); onAfter('delete', undefined); }, onError: fail, onSettled: settled });
    } else {
      const op = choice.op;
      act.mutate({ id: record.id, op, expectedVersion: record.version, ...(correctionDate ? { correctionDate } : {}) }, { onSuccess: (rec) => { toast.success(choice.done); onAfter(op, rec); }, onError: fail, onSettled: settled });
    }
  };
  const actions = [
    { op: 'submit' as const, visible: isDoc && ds === 0 && entity.ops.includes('submit'), title: t(S.submit), message: t(S.confirmSubmit), done: t(S.submitted) },
    { op: 'cancel' as const, visible: isDoc && ds === 1 && entity.ops.includes('cancel'), title: t(S.cancelDoc), message: t(S.confirmCancel), done: t(S.cancelled) },
    { op: 'amend' as const, visible: isDoc && ds === 2 && entity.ops.includes('amend'), title: t(S.amend), message: t(S.amend), done: t(S.amended) },
    { op: 'delete' as const, visible: entity.ops.includes('delete') && (!isDoc || ds === 0), title: t(S.delete), message: t(S.confirmDelete), done: t(S.deleted) },
  ].filter((a) => a.visible);
  if (!actions.length) return null;
  return <div className="flex flex-wrap items-center gap-2">
    {blocked ? <span role="status" className="dirty-label">{blocked}</span> : null}
    {submitBlocked && ds === 0 ? <span role="alert" data-testid="submit-blocked" className="text-xs text-red-700">{submitBlocked}</span> : null}
    {actions.map((action) => <button key={action.op} type="button" className={`btn ${action.op === 'submit' ? 'btn-primary' : action.op === 'cancel' ? 'btn-danger' : ''}`} disabled={busy || (action.op === 'submit' && submitBlocked !== undefined)} title={blocked ?? (action.op === 'submit' ? submitBlocked : undefined)} onClick={() => setChoice(action)}>{action.title}</button>)}
    {choice ? <ActionConfirm title={choice.title} message={choice.message} cancelDocument={choice.op === 'cancel'} destructive={choice.op === 'cancel' || choice.op === 'delete'} onConfirm={execute} onClose={() => setChoice(null)} /> : null}
  </div>;
}
