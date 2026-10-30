// AC-4 / AC-7: metadata-driven form. Create -> POST; update -> PATCH {patch, expectedVersion}; CONFLICT -> reload prompt.
// web-phase1 AC-1: documents with `lines` render one LineGrid per line entity below the header; one request saves both.
// web-phase15: registered ext fields in a 「追加項目」 fieldset (AC-3); the allocation picker on `*_allocation` grids and
// the client-side 配分合計 > 金額 refusal (AC-1/AC-2).
// form-ergonomics (docs/specs/form-ergonomics.md): labelled sections and narrow-screen tabs (AC-2), the error summary
// with focus on the first invalid input (AC-3), required marks and helper text (AC-4), Ctrl/⌘+S and Ctrl/⌘+Enter
// (AC-5), the bottom bar with Save / Submit on narrow screens (AC-7), unsaved-input drafts (AC-8), the shortcut list (AC-10).
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { isApiError } from '../api/client.ts';
import { keys, useCreate, useMeta, useUpdate } from '../api/queries.ts';
import type { EntityMeta, FieldMeta, RecordJson } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { ALLOCATION, allocationSummary, type AllocationConvention } from '../lib/allocation.ts';
import { extFieldsOf, extInitialValues, isExtFieldEditable } from '../lib/ext.ts';
import {
  formSections,
  initialValues,
  isFieldEditable,
  issuesToFieldErrors,
  needsInput,
  sectionLayout,
  type EditContext,
  type FormValue,
  type FormValues,
} from '../lib/form.ts';
import { errorSummary, firstTarget, type SummaryItem } from '../lib/form-errors.ts';
import { advanceAction, formShortcut, IS_MAC, shortcutLabel } from '../lib/form-shortcuts.ts';
import { draftTarget } from '../lib/form-draft.ts';
import { linesFromRecord, rowErrorsByKey, splitLineIssues, type GridErrors, type GridRow } from '../lib/lines.ts';
import { lineSpecsOf, planSave, type LineSpecMeta } from '../lib/save.ts';
import { S } from '../strings.ts';
import { formFingerprint } from '../lib/dirty.ts';
import { lineLockReason } from '../lib/line-lock.ts';
import { seededLines, seededValues, type DraftSeed } from '../lib/duplicate.ts';
import { AllocationPicker, useAllocationConvention } from './allocation-picker.tsx';
import { FieldWidget } from './fields/field-widget.tsx';
import { FormDraftNotice, useFormDraft } from './form-draft.tsx';
import { FormErrorSummary } from './form-error-summary.tsx';
import { HeaderSections, useNarrowScreen, type HeaderSection } from './form-sections.tsx';
import { FormShortcutsHelp } from './form-shortcuts-help.tsx';
import { LineGrid } from './line-grid.tsx';
import { useToast } from './toast.tsx';

/** form-ergonomics AC-5/AC-7: the page's Submit (DocActions) as the form bar and Ctrl+Enter reach it. */
export interface SubmitControl {
  label: string;
  /** Why it cannot be used now (unsaved changes, saving, a blocked submit); undefined when it can. */
  blocked: string | undefined;
  /** Opens the submit confirmation (the same dialog as the header button). */
  onRequest: () => void;
}

export interface RecordFormProps {
  entity: EntityMeta;
  /** Absent on create. */
  record?: RecordJson | undefined;
  onSaved: (rec: RecordJson, mode: 'create' | 'update') => void;
  onCancel: () => void;
  onStatus?: (status: { dirty: boolean; saving: boolean }) => void;
  actionBusy?: boolean;
  /** document-links AC-1/AC-5: initial values of a new record (複製 / quick action); ignored when `record` is given. */
  initial?: DraftSeed | undefined;
  /** A draft document's Submit, when the user may submit it. */
  submit?: SubmitControl | undefined;
}

interface FormState {
  baseline: string;
  /** The values / rows the form started from (the record, the seed or the defaults): the draft diff base (AC-8). */
  base: { values: FormValues; lines: Record<string, GridRow[]> };
  record: RecordJson | undefined;
  values: FormValues;
  lines: Record<string, GridRow[]>;
  fieldErrors: Record<string, string>;
  lineErrors: Record<string, GridErrors>;
  formErrors: string[];
  conflict: boolean;
  /** Failed save attempts with errors; 0 = no summary. A new attempt moves focus again (AC-3). */
  attempt: number;
}

function freshState(
  entity: EntityMeta,
  specs: readonly LineSpecMeta[],
  record: RecordJson | undefined,
  seed?: DraftSeed,
): FormState {
  // A seed is the new record's starting point: the baseline, so only the user's own edits make the form dirty.
  const seeded = !record && seed ? seed : undefined;
  const values = seeded
    ? seededValues(entity, seeded)
    : { ...initialValues(entity.fields, record), ...extInitialValues(extFieldsOf(entity), record) };
  const lines = seeded ? seededLines(specs, seeded) : linesFromRecord(specs, record);
  return {
    values,
    lines,
    base: { values, lines },
    baseline: formFingerprint(values, lines),
    record,
    fieldErrors: {},
    lineErrors: {},
    formErrors: [],
    conflict: false,
    attempt: 0,
  };
}

function useFormState(
  entity: EntityMeta,
  specs: readonly LineSpecMeta[],
  record: RecordJson | undefined,
  seed: DraftSeed | undefined,
) {
  const [state, setState] = useState<FormState>(() => freshState(entity, specs, record, seed));
  // A refetched record (after save, reload or someone else's change) resets the form; keyed on version so typing is not clobbered.
  useEffect(() => {
    setState((s) => {
      if (formFingerprint(s.values, s.lines) === s.baseline) return freshState(entity, specs, record, seed);
      return record?.version !== s.record?.version ? { ...s, conflict: true } : s;
    });
  }, [entity, specs, record, seed]);
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
    <div
      role="alert"
      data-testid="conflict"
      className="flex items-center gap-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900"
    >
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
  const settled = () => {
    inFlight.current = false;
  };

  const fail = (e: unknown) => {
    // AC-7: a CONFLICT while editing means the version moved (or a unique clash); either way the fix is to reload.
    // On create the same code only means a unique clash, so the hint toast is enough.
    if (isApiError(e) && e.code === 'CONFLICT' && mode === 'update') setState((s) => ({ ...s, conflict: true }));
    if (isApiError(e) && e.code === 'VALIDATION') {
      const split = splitLineIssues(e.issues());
      const mapped = issuesToFieldErrors(
        split.rest,
        [...entity.fields, ...extFieldsOf(entity)].map((f) => f.name),
      );
      const lineErrors: Record<string, GridErrors> = {};
      for (const [line, byIndex] of Object.entries(split.lines))
        lineErrors[line] = rowErrorsByKey(state.lines[line] ?? [], byIndex);
      // form-ergonomics AC-3: a new attempt shows the summary and moves focus to the first invalid input.
      setState((s) => ({
        ...s,
        fieldErrors: { ...s.fieldErrors, ...mapped.fieldErrors },
        lineErrors,
        formErrors: mapped.formErrors,
        attempt: s.attempt + 1,
      }));
    }
    toast.error(e);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current || state.conflict || !entity.ops.includes(mode === 'create' ? 'create' : 'update')) return;
    // web-phase15 AC-2: 配分合計 > 金額 is refused before any request (the server validates again at submit).
    if (conv && allocationSummary(state.values[ALLOCATION.amountField], state.lines[conv.lineEntity] ?? []).over) {
      setState((s) => ({ ...s, formErrors: [t(S.overAllocated)], attempt: s.attempt + 1 }));
      toast.push({ kind: 'error', title: t(S.overAllocated) });
      return;
    }
    const plan = planSave({
      entity,
      mode,
      record,
      values: state.values,
      specs,
      lines: state.lines,
      originalLines: linesFromRecord(specs, record),
      requiredMessage: t(S.requiredFieldMissing),
    });
    if (plan.hasErrors) {
      setState((s) => ({
        ...s,
        fieldErrors: plan.fieldErrors,
        lineErrors: plan.lineErrors,
        formErrors: [],
        attempt: s.attempt + 1,
      }));
      toast.push({
        kind: 'error',
        title: t(Object.keys(plan.lineErrors).length > 0 ? S.linesHaveErrors : S.formHasErrors),
      });
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
    update.mutate(
      { id: record.id, patch, expectedVersion: record.version },
      { onSuccess: saved, onError: fail, onSettled: settled },
    );
  };

  return { submit, saving: create.isPending || update.isPending };
}

/** Header sections from `views.form` (create mode leaves out what the user cannot enter), then the ext fields. */
function useHeaderSections(entity: EntityMeta, mode: 'create' | 'update') {
  return useMemo<HeaderSection[]>(() => {
    const sections: HeaderSection[] = formSections(entity)
      .map((s) => ({ ...s, fields: s.fields.filter((f) => mode !== 'create' || (!f.serverOwned && !f.readOnly)) }))
      .filter((s) => s.fields.length > 0);
    const ext = extFieldsOf(entity);
    if (ext.length > 0) sections.push({ key: 'ext', label: S.extFields, fields: ext });
    return sections;
  }, [entity, mode]);
}

/**
 * AC-3: after a failed attempt, show the input's tab (narrow screens) and focus it once it is on the screen. The
 * focus waits for the render that shows the tab, so it runs in an effect after every render until it lands.
 */
function useFocusTarget(sectionOf: (item: SummaryItem) => string | undefined, selectTab: (key: string) => void) {
  const pending = useRef<string | null>(null);
  useEffect(() => {
    const id = pending.current;
    if (!id) return;
    const element = globalThis.document?.getElementById(id);
    if (!element) return;
    pending.current = null;
    element.focus();
    element.scrollIntoView?.({ block: 'center' });
  });
  return (item: SummaryItem) => {
    if (!item.targetId) return;
    const section = sectionOf(item);
    if (section) selectTab(section);
    pending.current = item.targetId;
    // Already on the screen: focus now (no re-render would follow a tab that is already selected).
    const element = globalThis.document?.getElementById(item.targetId);
    if (element) {
      pending.current = null;
      element.focus();
      element.scrollIntoView?.({ block: 'center' });
    }
  };
}

export function RecordForm({
  entity,
  record,
  onSaved,
  onCancel,
  onStatus,
  actionBusy = false,
  initial,
  submit: submitControl,
}: RecordFormProps) {
  const { t } = useLocale();
  const qc = useQueryClient();
  const meta = useMeta();
  const mode: 'create' | 'update' = record ? 'update' : 'create';
  const specs = useMemo(() => lineSpecsOf(entity, meta.data?.entities ?? []), [entity, meta.data]);
  const conv = useAllocationConvention(entity);
  const { state, setState, setValue, setRows } = useFormState(entity, specs, record, initial);
  const exitAllowed = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = formFingerprint(state.values, state.lines) !== state.baseline;
  const canWrite = entity.ops.includes(mode === 'create' ? 'create' : 'update');
  // AC-8: unsaved input kept in this tab per entity and record (or `new`), offered when the screen opens again.
  const draft = useFormDraft({
    entity,
    target: draftTarget(record?.id, record ? undefined : initial?.key),
    recordVersion: record?.version,
    enabled: canWrite,
    specs,
    values: state.values,
    lines: state.lines,
    baseValues: state.base.values,
    baseLines: state.base.lines,
    dirty,
    onRestore: (values, lines) =>
      setState((s) => ({ ...s, values, lines, fieldErrors: {}, lineErrors: {}, formErrors: [], attempt: 0 })),
  });
  const { submit, saving } = useSave({
    entity,
    specs,
    record: state.record,
    state,
    setState,
    onSaved: (rec, savedMode) => {
      exitAllowed.current = true;
      draft.clear();
      onSaved(rec, savedMode);
    },
    conv,
  });
  useEffect(() => {
    if (dirty && !saving) exitAllowed.current = false;
    onStatus?.({ dirty, saving });
  }, [dirty, saving, onStatus]);
  useBlocker({
    shouldBlockFn: () =>
      !exitAllowed.current &&
      (saving ||
        (dirty &&
          !globalThis.confirm(
            t(
              draft.kept
                ? {
                    ja: '未保存の変更があります。保存せずに移動しますか？入力はこのタブに一時保存され、この画面に戻ると復元できます。',
                    en: 'You have unsaved changes. Leave without saving? Your input is kept in this tab and can be restored when you come back.',
                  }
                : {
                    ja: '未保存の変更があります。変更を破棄して移動しますか？',
                    en: 'Discard your unsaved changes and leave?',
                  },
            ),
          ))),
    enableBeforeUnload: dirty || saving,
  });
  const editCtx: EditContext = { mode, docstatus: record?.docstatus, allowOnSubmit: entity.allowOnSubmit };
  const editable =
    canWrite &&
    (entity.fields.some((f) => isFieldEditable(f, editCtx)) ||
      extFieldsOf(entity).some((f) => isExtFieldEditable(f, editCtx)));
  // AC-1: grids are read-only while the document is submitted/cancelled (kernel freezes lines) or the caller may not update.
  const lineLock = lineLockReason({
    canWrite,
    actionBusy,
    saving,
    conflict: state.conflict,
    frozen: mode === 'update' && (record?.docstatus ?? 0) !== 0,
  });
  const linesReadOnly = lineLock !== undefined;
  const locked = !canWrite || actionBusy || saving || state.conflict;
  const canSave = canWrite && (editable || !linesReadOnly) && !actionBusy && !saving && !state.conflict;

  // AC-2: sections, and tabs on a narrow screen with 4 or more labelled sections.
  const sections = useHeaderSections(entity, mode);
  const narrow = useNarrowScreen();
  const layout = sectionLayout(sections, narrow);
  const [tab, setTab] = useState(sections[0]?.key ?? '');

  // AC-3: the summary of the last failed attempt, in form order; it shrinks as the user fixes the inputs.
  const summary = useMemo(
    () =>
      state.attempt > 0
        ? errorSummary({
            sections,
            allFields: [...entity.fields, ...extFieldsOf(entity)],
            fieldErrors: state.fieldErrors,
            formErrors: state.formErrors,
            lines: specs.map((s) => ({
              line: s.line,
              columns: s.columns,
              rows: state.lines[s.line.name] ?? [],
              errors: state.lineErrors[s.line.name] ?? {},
            })),
          })
        : [],
    [state.attempt, state.fieldErrors, state.formErrors, state.lines, state.lineErrors, sections, entity, specs],
  );
  const errorCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of summary) if (item.section) counts[item.section] = (counts[item.section] ?? 0) + 1;
    return counts;
  }, [summary]);
  const jump = useFocusTarget(
    (item) => (layout === 'tabs' ? item.section : undefined),
    (key) => setTab(key),
  );
  const lastAttempt = useRef(0);
  useEffect(() => {
    if (state.attempt === 0 || state.attempt === lastAttempt.current) return;
    lastAttempt.current = state.attempt;
    const first = firstTarget(summary);
    if (first) jump(first);
    // Only a new attempt moves focus; later edits that shrink the summary must not.
  }, [state.attempt, summary, jump]);

  // AC-5: Ctrl/⌘+S saves from anywhere on the record screen (never the browser's save dialog); Ctrl/⌘+Enter inside
  // the form saves unsaved work or opens the submit confirmation of a clean draft document. While a modal dialog is
  // open the keys are left to it.
  const keyState = useRef({ dirty, canSave, mode, submitControl });
  keyState.current = { dirty, canSave, mode, submitControl };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const shortcut = formShortcut(event, IS_MAC);
      if (!shortcut || document.querySelector('dialog[open], [aria-modal="true"]')) return;
      const form = formRef.current;
      if (!form) return;
      const s = keyState.current;
      if (shortcut === 'save') {
        event.preventDefault();
        if (s.canSave) form.requestSubmit();
        return;
      }
      if (!(event.target instanceof Node) || !form.contains(event.target)) return;
      const action = advanceAction({
        isNew: s.mode === 'create',
        dirty: s.dirty,
        canSave: s.canSave,
        canSubmit: s.submitControl !== undefined && s.submitControl.blocked === undefined,
      });
      if (!action) return;
      event.preventDefault();
      if (action === 'submit') s.submitControl?.onRequest();
      else form.requestSubmit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Explicit reset after refetch: if nothing changed server-side the record reference is reused (structural sharing)
  // and the effect in useFormState would not fire.
  const reload = async () => {
    const key = keys.record(entity.name, record?.id ?? '');
    await qc.invalidateQueries({ queryKey: key });
    setState(freshState(entity, specs, qc.getQueryData<RecordJson>(key) ?? record));
  };
  const renderField = (f: FieldMeta, section: HeaderSection) => (
    <FieldWidget
      key={f.name}
      field={f}
      value={state.values[f.name] ?? ''}
      onChange={(v) => setValue(f.name, v)}
      disabled={locked || !(section.key === 'ext' ? isExtFieldEditable(f, editCtx) : isFieldEditable(f, editCtx))}
      error={state.fieldErrors[f.name]}
      alertError={false}
    />
  );
  const anyRequired = sections.some((s) =>
    s.fields.some((f) =>
      needsInput(f, !locked && (s.key === 'ext' ? isExtFieldEditable(f, editCtx) : isFieldEditable(f, editCtx))),
    ),
  );
  const saveKeys = shortcutLabel('S', IS_MAC);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        if (actionBusy || !canWrite) e.preventDefault();
        else submit(e);
      }}
      noValidate
      className="record-form flex flex-col gap-3"
      data-testid="record-form"
      data-mode={mode}
      data-dirty={dirty}
      data-layout={layout}
    >
      <FormDraftNotice control={draft} />
      {state.conflict ? <ConflictBanner onReload={() => void reload()} /> : null}
      <FormErrorSummary items={summary} onJump={jump} />
      {!canWrite ? (
        <p className="notice">
          {t({ ja: '閲覧モード — この記録は編集できません。', en: 'View mode — you cannot edit this record.' })}
        </p>
      ) : null}
      {anyRequired ? (
        <p className="text-[11px] text-text-muted" data-testid="required-legend">
          <span className="text-red-600" aria-hidden="true">
            *
          </span>{' '}
          {t({ ja: 'は入力が必要な項目です', en: 'marks a field you must fill in' })}
        </p>
      ) : null}
      <HeaderSections
        sections={sections}
        layout={layout}
        selected={tab}
        onSelect={setTab}
        errorCounts={errorCounts}
        renderField={renderField}
        idPrefix={`form-${entity.name}`}
      />
      {specs.map((s) => {
        const rows = state.lines[s.line.name] ?? [];
        return (
          <LineGrid
            key={s.line.name}
            line={s.line}
            columns={s.columns}
            rows={rows}
            onChange={(next) => setRows(s.line.name, next)}
            readOnly={linesReadOnly}
            readOnlyReason={t(lineLock)}
            errors={state.lineErrors[s.line.name] ?? {}}
          >
            {conv?.lineEntity === s.line.name ? (
              <AllocationPicker
                conv={conv}
                columns={s.columns}
                values={state.values}
                rows={rows}
                onAppend={(added) => setRows(s.line.name, [...rows, ...added])}
                readOnly={linesReadOnly}
              />
            ) : null}
          </LineGrid>
        );
      })}
      <div className="form-toolbar flex items-center gap-2" data-testid="form-toolbar">
        {canWrite && (editable || !linesReadOnly) ? (
          <button
            type="submit"
            className="btn btn-primary"
            aria-keyshortcuts={saveKeys.aria}
            title={`${t(S.save)} (${saveKeys.text})`}
            disabled={actionBusy || saving || state.conflict || (!editable && linesReadOnly)}
          >
            {saving ? t(S.saving) : t(S.save)}
          </button>
        ) : null}
        {/* AC-7: on a narrow screen the header's Submit moves into this bar (CSS shows one of the two). */}
        {submitControl ? (
          <button
            type="button"
            className="btn btn-primary form-bar-submit"
            data-testid="form-bar-submit"
            disabled={submitControl.blocked !== undefined}
            title={submitControl.blocked}
            onClick={submitControl.onRequest}
          >
            {submitControl.label}
          </button>
        ) : null}
        {dirty ? (
          <span className="dirty-label" role="status">
            {t({ ja: '未保存の変更', en: 'Unsaved changes' })}
          </span>
        ) : null}
        <button type="button" className="btn" onClick={onCancel}>
          {t(S.cancel)}
        </button>
        <span className="ml-auto flex items-center gap-2">
          {canWrite ? (
            <span className="form-shortcut-hint text-xs text-text-muted" aria-hidden="true">
              {saveKeys.text}
            </span>
          ) : null}
          <FormShortcutsHelp />
        </span>
      </div>
    </form>
  );
}
