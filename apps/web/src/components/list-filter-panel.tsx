// list-workbench AC-1/AC-2/AC-12: the generic list's filter form, built from the entity's FilterDefs. Edits stay in a
// draft until "Apply", so a half-typed date or amount never reaches the URL; invalid values are named, not sent.
// The form stays mounted while filters change (focus stays on "Apply" / "Clear all"); a change from outside the form
// (a removed chip, a saved view, the back button) replaces the draft. A refused apply moves focus to the first invalid
// control so the reason under it is read.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Label } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import {
  DOCSTATUS_VALUES,
  parseFilterValue,
  type DateRange,
  type FilterDef,
  type ListFilters,
  type NumberRange,
} from '../lib/list-filters.ts';
import { DOCSTATUS_LABELS } from '../lib/format.ts';
import { Button, Card } from '../ui/index.ts';
import { RefField } from './fields/ref-field.tsx';

const W = {
  apply: { ja: '絞り込む', en: 'Apply filters' },
  clear: { ja: 'すべてクリア', en: 'Clear all' },
  from: { ja: '開始', en: 'From' },
  to: { ja: '終了', en: 'To' },
  min: { ja: '最小', en: 'Min' },
  max: { ja: '最大', en: 'Max' },
  any: { ja: '指定なし', en: 'Any' },
  yes: { ja: 'はい', en: 'Yes' },
  no: { ja: 'いいえ', en: 'No' },
  badDate: { ja: '日付を確認し、開始は終了以前にしてください。', en: 'Check the dates; From must not be after To.' },
  badRange: {
    ja: '数値で入力し、最小は最大以下にしてください。',
    en: 'Enter numbers; Min must not be greater than Max.',
  },
  badInteger: {
    ja: '整数で入力し、最小は最大以下にしてください。',
    en: 'Enter whole numbers; Min must not be greater than Max.',
  },
} satisfies Record<string, Label>;

type Draft = Record<string, unknown>;

function toDraft(def: FilterDef, value: unknown): unknown {
  switch (def.kind) {
    case 'docstatus':
    case 'enum':
      return Array.isArray(value) ? value : [];
    case 'date': {
      const range = (value ?? {}) as DateRange;
      return { from: range.from ?? '', to: range.to ?? '' };
    }
    case 'range': {
      const range = (value ?? {}) as NumberRange;
      return { min: range.min ?? '', max: range.max ?? '' };
    }
    case 'ref':
      return typeof value === 'string' ? value : '';
    case 'bool':
      return value === true ? 'true' : value === false ? 'false' : '';
  }
}

/** Draft control value -> candidate filter value; undefined when the control is empty. */
function fromDraft(def: FilterDef, draft: unknown): unknown {
  switch (def.kind) {
    case 'docstatus':
    case 'enum':
      return Array.isArray(draft) && draft.length ? draft : undefined;
    case 'date': {
      const { from, to } = draft as { from: string; to: string };
      return from || to ? { ...(from ? { from } : {}), ...(to ? { to } : {}) } : undefined;
    }
    case 'range': {
      const { min, max } = draft as { min: string; max: string };
      const a = min.trim();
      const b = max.trim();
      return a || b ? { ...(a ? { min: a } : {}), ...(b ? { max: b } : {}) } : undefined;
    }
    case 'ref':
      return typeof draft === 'string' && draft ? draft : undefined;
    case 'bool':
      return draft === 'true' ? true : draft === 'false' ? false : undefined;
  }
}

/** Draft -> filters, or the keys whose control holds an invalid value. */
export function draftToFilters(defs: readonly FilterDef[], draft: Draft): { filters: ListFilters; invalid: string[] } {
  const filters: ListFilters = {};
  const invalid: string[] = [];
  for (const def of defs) {
    const candidate = fromDraft(def, draft[def.key]);
    if (candidate === undefined) continue;
    const value = parseFilterValue(def, candidate);
    if (value === undefined) invalid.push(def.key);
    else filters[def.key] = value;
  }
  return { filters, invalid };
}

interface Props {
  id: string;
  defs: readonly FilterDef[];
  filters: ListFilters;
  onApply: (filters: ListFilters) => void;
}

export function ListFilterPanel({ id, defs, filters, onApply }: Props) {
  const { t, locale } = useLocale();
  const uid = useId();
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(defs.map((def) => [def.key, toDraft(def, filters[def.key])])),
  );
  const [invalid, setInvalid] = useState<string[]>([]);
  const synced = useRef(JSON.stringify(filters));
  useEffect(() => {
    const json = JSON.stringify(filters);
    if (json === synced.current) return;
    synced.current = json;
    setDraft(Object.fromEntries(defs.map((def) => [def.key, toDraft(def, filters[def.key])])));
    setInvalid([]);
  }, [filters, defs]);
  const focusInvalid = useRef(false);
  useEffect(() => {
    if (!focusInvalid.current) return;
    focusInvalid.current = false;
    globalThis.document?.getElementById(id)?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [invalid, id]);
  const set = (key: string, value: unknown) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setInvalid((keys) => keys.filter((k) => k !== key));
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const result = draftToFilters(defs, draft);
    focusInvalid.current = result.invalid.length > 0;
    setInvalid(result.invalid);
    if (result.invalid.length === 0) onApply(result.filters);
  };
  const toggle = (key: string, value: string | number, on: boolean) => {
    const current = (draft[key] as (string | number)[] | undefined) ?? [];
    set(key, on ? [...current.filter((v) => v !== value), value] : current.filter((v) => v !== value));
  };
  return (
    <Card as="form" id={id} className="list-filter-panel" onSubmit={submit} noValidate>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
        {defs.map((def) => {
          const errorId = `${uid}-${def.key}-error`;
          const bad = invalid.includes(def.key);
          const describedBy = bad ? errorId : undefined;
          const error = bad ? (
            <p id={errorId} className="ui-field-error">
              {t(def.kind === 'date' ? W.badDate : def.integer ? W.badInteger : W.badRange)}
            </p>
          ) : null;
          const legend = <legend className="mb-1 text-xs font-semibold text-text-secondary">{t(def.label)}</legend>;
          switch (def.kind) {
            case 'docstatus':
            case 'enum': {
              const options =
                def.kind === 'docstatus'
                  ? DOCSTATUS_VALUES.map((d) => ({ value: d as string | number, label: t(DOCSTATUS_LABELS[d]) }))
                  : (def.field?.values ?? []).map((v) => ({
                      value: v as string | number,
                      label: def.field?.valueLabels?.[v]?.[locale] ?? v,
                    }));
              const picked = (draft[def.key] as (string | number)[] | undefined) ?? [];
              return (
                <fieldset key={def.key} data-filter={def.key} className="min-w-0">
                  {legend}
                  <div className="flex max-h-40 flex-wrap gap-x-3 gap-y-1 overflow-auto">
                    {options.map((o) => (
                      <label key={String(o.value)} className="inline-flex items-center gap-1 text-sm">
                        <input
                          type="checkbox"
                          className="ui-row-check"
                          checked={picked.includes(o.value)}
                          onChange={(e) => toggle(def.key, o.value, e.target.checked)}
                        />
                        {o.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            }
            case 'date':
            case 'range': {
              const value = draft[def.key] as Record<string, string>;
              const [a, b] = def.kind === 'date' ? (['from', 'to'] as const) : (['min', 'max'] as const);
              const labels = def.kind === 'date' ? [W.from, W.to] : [W.min, W.max];
              return (
                <fieldset key={def.key} data-filter={def.key} className="min-w-0">
                  {legend}
                  <div className="grid grid-cols-2 gap-2">
                    {[a, b].map((part, i) => (
                      <label key={part} className="flex min-w-0 flex-col gap-0.5 text-xs text-text-secondary">
                        {t(labels[i])}
                        <input
                          type={def.kind === 'date' ? 'date' : 'text'}
                          inputMode={def.kind === 'range' ? (def.integer ? 'numeric' : 'decimal') : undefined}
                          className={`input ${bad ? 'input-error' : ''}`}
                          value={value[part] ?? ''}
                          aria-invalid={bad || undefined}
                          aria-describedby={describedBy}
                          onChange={(e) => set(def.key, { ...value, [part]: e.target.value })}
                        />
                      </label>
                    ))}
                  </div>
                  {error}
                </fieldset>
              );
            }
            case 'ref': {
              const inputId = `${uid}-${def.key}`;
              return (
                <div key={def.key} data-filter={def.key} className="flex min-w-0 flex-col">
                  <label htmlFor={inputId} className="mb-1 text-xs font-semibold text-text-secondary">
                    {t(def.label)}
                  </label>
                  {def.field ? (
                    <RefField
                      id={inputId}
                      field={def.field}
                      value={(draft[def.key] as string) ?? ''}
                      onChange={(v) => set(def.key, typeof v === 'string' ? v : '')}
                      disabled={false}
                      invalid={bad}
                    />
                  ) : null}
                </div>
              );
            }
            case 'bool': {
              const inputId = `${uid}-${def.key}`;
              return (
                <div key={def.key} data-filter={def.key} className="flex min-w-0 flex-col">
                  <label htmlFor={inputId} className="mb-1 text-xs font-semibold text-text-secondary">
                    {t(def.label)}
                  </label>
                  <select
                    id={inputId}
                    className="input"
                    value={(draft[def.key] as string) ?? ''}
                    onChange={(e) => set(def.key, e.target.value)}
                  >
                    <option value="">{t(W.any)}</option>
                    <option value="true">{t(W.yes)}</option>
                    <option value="false">{t(W.no)}</option>
                  </select>
                </div>
              );
            }
          }
        })}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          onClick={() => {
            setDraft(Object.fromEntries(defs.map((def) => [def.key, toDraft(def, undefined)])));
            setInvalid([]);
            onApply({});
          }}
        >
          {t(W.clear)}
        </Button>
        <Button type="submit" variant="primary">
          {t(W.apply)}
        </Button>
      </div>
    </Card>
  );
}
