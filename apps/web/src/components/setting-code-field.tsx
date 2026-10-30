// settings-console AC-10: an account / warehouse code chosen from the company's own list ("code name"); the stored
// value stays the code string. A stored code that is not in the list stays selectable and is flagged (a code beyond a
// cut-off list is looked up by itself first). An optional field can be emptied ("not specified"). The code can also be
// typed (a record created later, ADR-0027); when the list cannot be read (no permission, network) typing is the only way.
import { useEffect, useRef, useState } from 'react';
import { isApiError } from '../api/client.ts';
import { useCodeLookup, useCodeOptions } from '../api/settings.ts';
import type { CodeOption, SettingWidget } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import type { FormValue } from '../lib/form.ts';
import type { SchemaField } from '../lib/schema.ts';
import { codeIsMissing, codeLookupNeeded, fill, SC } from '../lib/settings-console.ts';
import { S } from '../strings.ts';
import { cx } from '../ui/index.ts';

export type CodeWidget = Exclude<SettingWidget, 'textarea'>;

/** Value of the select's "type a code" choice; not a code anyone stores (it starts with a control character). */
const TYPE_CODE = '\u001ftype-code';

export interface SettingCodeFieldProps {
  field: SchemaField;
  widget: CodeWidget;
  value: FormValue;
  onChange: (value: string) => void;
  disabled: boolean;
  error: string | undefined;
  idPrefix: string;
}

const describedBy = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(' ') || undefined;

export function SettingCodeField({ field, widget, value, onChange, disabled, error, idPrefix }: SettingCodeFieldProps) {
  const { t, locale } = useLocale();
  const codes = useCodeOptions(widget);
  const [typing, setTyping] = useState(false);
  const code = typeof value === 'string' ? value : '';
  const list = codes.data;
  const needsLookup = list !== undefined && !typing && codeLookupNeeded(code, list);
  const lookup = useCodeLookup(widget, code, needsLookup);
  const id = `${idPrefix}-${field.name}`;
  const noteId = `${id}-note`;
  const helpId = `${id}-help`;
  const input = useRef<HTMLInputElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    // Focus follows a switch between picking and typing (not the first render).
    if (!moved.current) return;
    moved.current = false;
    (typing ? input.current : select.current)?.focus();
  }, [typing]);
  const switchTo = (next: boolean) => {
    moved.current = true;
    setTyping(next);
  };

  const invalid = error !== undefined;
  const label = (
    <label htmlFor={id} className="text-xs font-medium text-text-secondary">
      {t(field.label)}
      {field.required && !disabled ? (
        <span className="ml-0.5 text-danger-text" title={t(S.required)} aria-hidden="true">
          *
        </span>
      ) : null}
    </label>
  );
  const help = field.help ? (
    <span id={helpId} className="text-[11px] text-text-muted">
      {t(field.help)}
    </span>
  ) : null;
  const errorText = error ? (
    <span role="alert" className="ui-field-error">
      {error}
    </span>
  ) : null;

  if (codes.isError || typing) {
    const forbidden = codes.isError && isApiError(codes.error) && codes.error.status === 403;
    const note = codes.isError ? (forbidden ? SC.codeForbidden[widget] : SC.codeUnavailable) : SC.typedNote;
    return (
      <div data-field={field.name} data-widget={widget} className="flex min-w-0 flex-col gap-0.5">
        {label}
        <input
          ref={input}
          id={id}
          name={field.name}
          type="text"
          className={cx('input font-mono', invalid && 'input-error')}
          value={code}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={describedBy(noteId, help !== null && helpId)}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
        />
        <span id={noteId} className="text-[11px] text-text-muted">
          {t(note)}
        </span>
        {help}
        {!codes.isError ? (
          <button
            type="button"
            className="ui-link self-start text-xs"
            disabled={disabled}
            onClick={() => switchTo(false)}
          >
            {t(SC.pickCode)}
          </button>
        ) : null}
        {errorText}
      </div>
    );
  }

  const options = list?.options ?? [];
  const found: CodeOption | null | undefined = needsLookup ? (lookup.isSuccess ? lookup.data : undefined) : null;
  const missing = list !== undefined && codeIsMissing(code, list, found);
  const extra = found && !options.some((o) => o.code === found.code) ? found : null;
  const truncated = list !== undefined && list.total > options.length;
  return (
    <div data-field={field.name} data-widget={widget} className="flex min-w-0 flex-col gap-0.5">
      {label}
      <select
        ref={select}
        id={id}
        name={field.name}
        className={cx('input', invalid && 'input-error')}
        value={code}
        required={field.required}
        disabled={disabled || codes.isPending}
        aria-invalid={invalid || missing}
        aria-describedby={describedBy(missing && noteId, help !== null && helpId)}
        aria-busy={codes.isPending}
        onChange={(e) => (e.target.value === TYPE_CODE ? switchTo(true) : onChange(e.target.value))}
      >
        {!field.required ? (
          <option value="">{t(SC.notSpecified)}</option>
        ) : code === '' ? (
          <option value="">{t(SC.choose)}</option>
        ) : null}
        {missing ? <option value={code}>{fill(SC.codeNotFoundOption, locale, { code })}</option> : null}
        {(codes.isPending || (needsLookup && !extra && !missing)) && code !== '' ? (
          <option value={code}>{code}</option>
        ) : null}
        {extra ? <option value={extra.code}>{extra.name ? `${extra.code} ${extra.name}` : extra.code}</option> : null}
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.name ? `${o.code} ${o.name}` : o.code}
          </option>
        ))}
        {list !== undefined ? <option value={TYPE_CODE}>{t(SC.typeCode)}</option> : null}
      </select>
      {missing ? (
        <span id={noteId} className="text-xs text-warning-on-soft" data-testid={`code-missing-${field.name}`}>
          {fill(SC.codeMissing[widget], locale, { code })}
        </span>
      ) : null}
      {truncated ? (
        <span className="text-[11px] text-text-muted" data-testid={`codes-truncated-${field.name}`}>
          {fill(SC.codesTruncated, locale, { n: options.length, total: list?.total ?? options.length })}
        </span>
      ) : null}
      {help}
      {errorText}
    </div>
  );
}
