// settings-console AC-10: an account / warehouse code chosen from the company's own list ("code name"); the stored
// value stays the code string. A stored code that is not in the list stays selectable and is flagged; when the list
// cannot be read (no permission, network) the field falls back to typing the code.
import { CODE_OPTION_LIMIT, useCodeOptions } from '../api/settings.ts';
import type { SettingWidget } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import type { FormValue } from '../lib/form.ts';
import type { SchemaField } from '../lib/schema.ts';
import { fill, SC } from '../lib/settings-console.ts';
import { S } from '../strings.ts';
import { cx } from '../ui/index.ts';

export type CodeWidget = Exclude<SettingWidget, 'textarea'>;

export interface SettingCodeFieldProps {
  field: SchemaField;
  widget: CodeWidget;
  value: FormValue;
  onChange: (value: string) => void;
  disabled: boolean;
  error: string | undefined;
  idPrefix: string;
}

export function SettingCodeField({ field, widget, value, onChange, disabled, error, idPrefix }: SettingCodeFieldProps) {
  const { t, locale } = useLocale();
  const codes = useCodeOptions(widget);
  const id = `${idPrefix}-${field.name}`;
  const noteId = `${id}-note`;
  const code = typeof value === 'string' ? value : '';
  const options = codes.data ?? [];
  const missing = code !== '' && codes.isSuccess && !options.some((o) => o.code === code);
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
  const help = field.help ? <span className="text-[11px] text-text-muted">{t(field.help)}</span> : null;
  if (codes.isError) {
    return (
      <div data-field={field.name} className="flex flex-col gap-0.5">
        {label}
        <input
          id={id}
          name={field.name}
          type="text"
          className={cx('input font-mono', invalid && 'input-error')}
          value={code}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={noteId}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
        />
        <span id={noteId} className="text-[11px] text-text-muted">
          {t(SC.codeUnavailable)}
        </span>
        {error ? (
          <span role="alert" className="ui-field-error">
            {error}
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <div data-field={field.name} data-widget={widget} className="flex min-w-0 flex-col gap-0.5">
      {label}
      <select
        id={id}
        name={field.name}
        className={cx('input', invalid && 'input-error')}
        value={code}
        required={field.required}
        disabled={disabled || codes.isPending}
        aria-invalid={invalid || missing}
        aria-describedby={missing ? noteId : undefined}
        aria-busy={codes.isPending}
        onChange={(e) => onChange(e.target.value)}
      >
        {code === '' ? <option value="">{t(SC.choose)}</option> : null}
        {missing ? <option value={code}>{fill(SC.codeNotFoundOption, locale, { code })}</option> : null}
        {codes.isPending && code !== '' ? <option value={code}>{code}</option> : null}
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.name ? `${o.code} ${o.name}` : o.code}
          </option>
        ))}
      </select>
      {missing ? (
        <span id={noteId} className="text-xs text-warning-on-soft" data-testid={`code-missing-${field.name}`}>
          {fill(SC.codeMissing[widget], locale, { code })}
        </span>
      ) : null}
      {options.length >= CODE_OPTION_LIMIT ? (
        <span className="text-[11px] text-text-muted">{fill(SC.codesTruncated, locale, { n: CODE_OPTION_LIMIT })}</span>
      ) : null}
      {error ? (
        <span role="alert" className="ui-field-error">
          {error}
        </span>
      ) : (
        help
      )}
    </div>
  );
}
