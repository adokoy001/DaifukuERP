// AC-4 / AC-7: metadata-driven form. Create -> POST; update -> PATCH {patch, expectedVersion}; CONFLICT -> reload prompt.
// web-phase1 AC-1: documents with `lines` render one LineGrid per line entity below the header; one request saves both.
// web-phase15: registered ext fields in a 「追加項目」 fieldset (AC-3); the allocation picker on `*_allocation` grids and
// the client-side 配分合計 > 金額 refusal (AC-1/AC-2).
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { isApiError } from '../api/client.ts';
import { keys, useCreate, useMeta, useUpdate } from '../api/queries.ts';
import type { EntityMeta, FieldMeta, RecordJson } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { ALLOCATION, allocationSummary, type AllocationConvention } from '../lib/allocation.ts';
import { extFieldsOf, extInitialValues, isExtFieldEditable } from '../lib/ext.ts';
import { formGroups, initialValues, isFieldEditable, issuesToFieldErrors, type EditContext, type FormValue, type FormValues } from '../lib/form.ts';
import { linesFromRecord, rowErrorsByKey, splitLineIssues, type GridErrors, type GridRow } from '../lib/lines.ts';
import { lineSpecsOf, planSave, type LineSpecMeta } from '../lib/save.ts';
import { S } from '../strings.ts';
import { formFingerprint } from '../lib/dirty.ts';
import { lineLockReason } from '../lib/line-lock.ts';
import { AllocationPicker, useAllocationConvention } from './allocation-picker.tsx';
import { FieldWidget } from './fields/field-widget.tsx';
import { LineGrid } from './line-grid.tsx';
import { useToast } from './toast.tsx';

export interface RecordFormProps {
  entity: EntityMeta;
  /** Absent on create. */
  record?: RecordJson | undefined;
  onSaved: (rec: RecordJson, mode: 'create' | 'update') => void;
  onCancel: () => void;
  onStatus?: (status: { dirty: boolean; saving: boolean }) => void;
  actionBusy?: boolean;
}

interface FormState {
  baseline: string;
  record: RecordJson | undefined;
  values: FormValues;
  lines: Record<string, GridRow[]>;
  fieldErrors: Record<string, string>;
  lineErrors: Record<string, GridErrors>;
  formErrors: string[];
  conflict: boolean;
}

function freshState(entity: EntityMeta, specs: readonly LineSpecMeta[], record: RecordJson | undefined): FormState {
  const values = { ...initialValues(entity.fields, record), ...extInitialValues(extFieldsOf(entity), record) };
  const lines = linesFromRecord(specs, record);
  return { values, lines, baseline: formFingerprint(values, lines), record, fieldErrors: {}, lineErrors: {}, formErrors: [], conflict: false };
}

function useFormState(entity: EntityMeta, specs: readonly LineSpecMeta[], record: RecordJson | undefined) {
  const [state, setState] = useState<FormState>(() => freshState(entity, specs, record));
  // A refetched record (after save, reload or someone else's change) resets the form; keyed on version so typing is not clobbered.
  useEffect(() => {
    setState((s) => {
      if (formFingerprint(s.values, s.lines) === s.baseline) return freshState(entity, specs, record);
      return record?.version !== s.record?.version ? { ...s, conflict: true } : s;
    });
  }, [entity, specs, record]);
  const setValue = (name: string, v: FormValue) =>
    setState((s) => {
      const fieldErrors = { ...s.fieldErrors };
      delete fieldErrors[name];
      return { ...s, values: { ...s.values, [name]: v }, fieldErrors };
    });
  const setRows = (line: string, rows: GridRow[]) =>
    setState((s) => {
      const lineErrors = { ...s.lineErrors };
      delete lineErrors[line];
      return { ...s, lines: { ...s.lines, [line]: rows }, lineErrors };
    });
  return { state, setState, setValue, setRows };
}

function ConflictBanner({ onReload }: { onReload: () => void }) {
  const { t } = useLocale();
  return (
    <div role="alert" data-testid="conflict" className="flex items-center gap-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
      <div className="flex-1">
        <div className="font-medium">{t(S.conflictTitle)}</div>
        <div className="text-xs">{t(S.conflictBody)}</div>
      </div>
      <button type="button" className="btn" onClick={onReload}>
        {t(S.reload)}
      </button>
    </div>
  );
}

interface SaveDeps {
  entity: EntityMeta;
  specs: readonly LineSpecMeta[];
  record: RecordJson | undefined;
  state: FormState;
  setState: React.Dispatch<React.SetStateAction<FormState>>;
  onSaved: RecordFormProps['onSaved'];
  conv: AllocationConvention | undefined;
}

/** Save pipeline: client checks -> POST or PATCH{patch, expectedVersion} -> server issues mapped to fields/cells (AC-4, AC-7, phase1 AC-1). */
function useSave({ entity, specs, record, state, setState, onSaved, conv }: SaveDeps) {
  const { t } = useLocale();
  const toast = useToast();
  const mode: 'create' | 'update' = record ? 'update' : 'create';
  const create = useCreate({ entity: entity.name });
  const update = useUpdate({ entity: entity.name });
  const inFlight = useRef(false);
  const saved = (rec: RecordJson) => {
    setState(freshState(entity, specs, rec));
    onSaved(rec, mode);
  };
  const settled = () => { inFlight.current = false; };

  const fail = (e: unknown) => {
    // AC-7: a CONFLICT while editing means the version moved (or a unique clash); either way the fix is to reload.
    // On create the same code only means a unique clash, so the hint toast is enough.
    if (isApiError(e) && e.code === 'CONFLICT' && mode === 'update') setState((s) => ({ ...s, conflict: true }));
    if (isApiError(e) && e.code === 'VALIDATION') {
      const split = splitLineIssues(e.issues());
      const mapped = issuesToFieldErrors(split.rest, [...entity.fields, ...extFieldsOf(entity)].map((f) => f.name));
      const lineErrors: Record<string, GridErrors> = {};
      for (const [line, byIndex] of Object.entries(split.lines)) lineErrors[line] = rowErrorsByKey(state.lines[line] ?? [], byIndex);
      setState((s) => ({ ...s, fieldErrors: { ...s.fieldErrors, ...mapped.fieldErrors }, lineErrors, formErrors: mapped.formErrors }));
    }
    toast.error(e);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current || state.conflict || !entity.ops.includes(mode === 'create' ? 'create' : 'update')) return;
    // web-phase15 AC-2: 配分合計 > 金額 is refused before any request (the server validates again at submit).
    if (conv && allocationSummary(state.values[ALLOCATION.amountField], state.lines[conv.lineEntity] ?? []).over) {
      setState((s) => ({ ...s, formErrors: [t(S.overAllocated)] }));
      toast.push({ kind: 'error', title: t(S.overAllocated) });
      return;
    }
    const plan = planSave({ entity, mode, record, values: state.values, specs, lines: state.lines, originalLines: linesFromRecord(specs, record), requiredMessage: t(S.requiredFieldMissing) });
    if (plan.hasErrors) {
      setState((s) => ({ ...s, fieldErrors: plan.fieldErrors, lineErrors: plan.lineErrors, formErrors: [] }));
      toast.push({ kind: 'error', title: t(Object.keys(plan.lineErrors).length > 0 ? S.linesHaveErrors : S.formHasErrors) });
      return;
    }
    if (!record) {
      inFlight.current = true;
      create.mutate(plan.body, { onSuccess: saved, onError: fail, onSettled: settled });
      return;
    }
    if (plan.empty) {
      toast.push({ kind: 'info', title: t(S.saved) });
      saved(record);
      return;
    }
    const patch = plan.body.patch as Record<string, unknown>;
    inFlight.current = true;
    update.mutate({ id: record.id, patch, expectedVersion: record.version }, { onSuccess: saved, onError: fail, onSettled: settled });
  };

  return { submit, saving: create.isPending || update.isPending };
}

interface HeaderFieldsProps {
  entity: EntityMeta;
  state: FormState;
  setValue: (name: string, v: FormValue) => void;
  editCtx: EditContext;
  locked: boolean;
}

/** Header fieldsets from `views.form`, then the registered ext fields under 「追加項目」 (AC-3, same widgets). */
function HeaderFields({ entity, state, setValue, editCtx, locked }: HeaderFieldsProps) {
  const { t } = useLocale();
  const groups = useMemo(() => formGroups(entity).map((group) => group.filter((f) => editCtx.mode !== 'create' || (!f.serverOwned && !f.readOnly))).filter((group) => group.length > 0), [entity, editCtx.mode]);
  const ext = useMemo(() => extFieldsOf(entity), [entity]);
  const widget = (f: FieldMeta, editable: boolean) => <FieldWidget key={f.name} field={f} value={state.values[f.name] ?? ''} onChange={(v) => setValue(f.name, v)} disabled={locked || !editable} error={state.fieldErrors[f.name]} />;
  const box = 'grid grid-cols-1 gap-x-4 gap-y-2 rounded border border-neutral-200 bg-white p-3 md:grid-cols-3';
  return (
    <>
      {groups.map((group, gi) => (
        <fieldset key={gi} className={box}>
          {group.map((f) => widget(f, isFieldEditable(f, editCtx)))}
        </fieldset>
      ))}
      {ext.length > 0 ? (
        <fieldset className={box} data-testid="ext-fields" aria-label={t(S.extFields)}>
          <legend className="px-1 text-xs font-semibold text-neutral-600">{t(S.extFields)}</legend>
          {ext.map((f) => widget(f, isExtFieldEditable(f, editCtx)))}
        </fieldset>
      ) : null}
    </>
  );
}

export function RecordForm({ entity, record, onSaved, onCancel, onStatus, actionBusy = false }: RecordFormProps) {
  const { t } = useLocale();
  const qc = useQueryClient();
  const meta = useMeta();
  const mode: 'create' | 'update' = record ? 'update' : 'create';
  const specs = useMemo(() => lineSpecsOf(entity, meta.data?.entities ?? []), [entity, meta.data]);
  const conv = useAllocationConvention(entity);
  const { state, setState, setValue, setRows } = useFormState(entity, specs, record);
  const exitAllowed = useRef(false);
  const { submit, saving } = useSave({ entity, specs, record: state.record, state, setState, onSaved: (rec, savedMode) => { exitAllowed.current = true; onSaved(rec, savedMode); }, conv });
  const dirty = formFingerprint(state.values, state.lines) !== state.baseline;
  const canWrite = entity.ops.includes(mode === 'create' ? 'create' : 'update');
  useEffect(() => { if (dirty && !saving) exitAllowed.current = false; onStatus?.({ dirty, saving }); }, [dirty, saving, onStatus]);
  useBlocker({ shouldBlockFn: () => !exitAllowed.current && (saving || (dirty && !globalThis.confirm(t({ ja: '未保存の変更があります。変更を破棄して移動しますか？', en: 'Discard your unsaved changes and leave?' })))), enableBeforeUnload: dirty || saving });
  const editCtx: EditContext = { mode, docstatus: record?.docstatus, allowOnSubmit: entity.allowOnSubmit };
  const editable = canWrite && (entity.fields.some((f) => isFieldEditable(f, editCtx)) || extFieldsOf(entity).some((f) => isExtFieldEditable(f, editCtx)));
  // AC-1: grids are read-only while the document is submitted/cancelled (kernel freezes lines) or the caller may not update.
  const lineLock = lineLockReason({ canWrite, actionBusy, saving, conflict: state.conflict, frozen: mode === 'update' && (record?.docstatus ?? 0) !== 0 });
  const linesReadOnly = lineLock !== undefined;

  // Explicit reset after refetch: if nothing changed server-side the record reference is reused (structural sharing)
  // and the effect in useFormState would not fire.
  const reload = async () => {
    const key = keys.record(entity.name, record?.id ?? '');
    await qc.invalidateQueries({ queryKey: key });
    setState(freshState(entity, specs, qc.getQueryData<RecordJson>(key) ?? record));
  };
  const onKey = (e: KeyboardEvent<HTMLFormElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') e.currentTarget.requestSubmit();
  };

  return (
    <form onSubmit={(e) => { if (actionBusy || !canWrite) e.preventDefault(); else submit(e); }} onKeyDown={onKey} noValidate className="record-form flex flex-col gap-3" data-testid="record-form" data-mode={mode} data-dirty={dirty}>
      {state.conflict ? <ConflictBanner onReload={() => void reload()} /> : null}
      {state.formErrors.length > 0 ? (
        <ul role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          {state.formErrors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      {!canWrite ? <p className="notice">{t({ ja: '閲覧モード — この記録は編集できません。', en: 'View mode — you cannot edit this record.' })}</p> : null}
      <HeaderFields entity={entity} state={state} setValue={setValue} editCtx={editCtx} locked={!canWrite || actionBusy || saving || state.conflict} />
      {specs.map((s) => {
        const rows = state.lines[s.line.name] ?? [];
        return (
          <LineGrid key={s.line.name} line={s.line} columns={s.columns} rows={rows} onChange={(next) => setRows(s.line.name, next)} readOnly={linesReadOnly} readOnlyReason={t(lineLock)} errors={state.lineErrors[s.line.name] ?? {}}>
            {conv?.lineEntity === s.line.name ? <AllocationPicker conv={conv} columns={s.columns} values={state.values} rows={rows} onAppend={(added) => setRows(s.line.name, [...rows, ...added])} readOnly={linesReadOnly} /> : null}
          </LineGrid>
        );
      })}
      <div className="form-toolbar flex items-center gap-2">
        {canWrite && (editable || !linesReadOnly) ? <button type="submit" className="btn btn-primary" disabled={actionBusy || saving || state.conflict || (!editable && linesReadOnly)}>
          {saving ? t(S.saving) : t(S.save)}
        </button> : null}
        {dirty ? <span className="dirty-label" role="status">{t({ ja: '未保存の変更', en: 'Unsaved changes' })}</span> : null}
        <button type="button" className="btn" onClick={onCancel}>
          {t(S.cancel)}
        </button>
        {canWrite ? <span className="ml-auto text-xs text-neutral-500">Ctrl+Enter</span> : null}
      </div>
    </form>
  );
}
