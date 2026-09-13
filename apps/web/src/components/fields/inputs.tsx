// AC-4 widgets by kind (all but ref, which lives in ref-field.tsx). Values are strings/booleans; conversion happens in lib/form.ts.
import { useState, type FocusEvent } from 'react';
import { useCurrencyScale } from '../../api/company.tsx';
import type { FieldMeta, RecordJson } from '../../api/types.ts';
import { useLocale } from '../../i18n.tsx';
import type { FormValue } from '../../lib/form.ts';
import { decimalMinScale, formatDecimalInput, formatTimestamp } from '../../lib/format.ts';
import { S } from '../../strings.ts';

export interface WidgetProps {
  id: string;
  field: FieldMeta;
  value: FormValue;
  onChange: (v: FormValue) => void;
  onSelectRecord?: (record: RecordJson) => void;
  disabled: boolean;
  invalid: boolean;
  /** Grid cells have no <label>; the column label is announced instead (web-phase1 AC-1). */
  ariaLabel?: string;
}

function str(v: FormValue): string {
  return typeof v === 'string' ? v : '';
}

function cls(invalid: boolean, extra = ''): string {
  return `input ${invalid ? 'input-error' : ''} ${extra}`.trim();
}

export function TextField({ id, field, value, onChange, disabled, invalid, ariaLabel }: WidgetProps) {
  const mono = field.kind === 'uuid' || field.name === 'code';
  return (
    <input
      id={id}
      name={field.name}
      type="text"
      className={cls(invalid, mono ? 'font-mono' : '')}
      value={str(value)}
      disabled={disabled}
      required={field.required}
      aria-invalid={invalid}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      autoComplete="off"
    />
  );
}

export function TextAreaField({ id, field, value, onChange, disabled, invalid, ariaLabel }: WidgetProps) {
  return (
    <textarea
      id={id}
      name={field.name}
      rows={3}
      className={cls(invalid)}
      value={str(value)}
      disabled={disabled}
      required={field.required}
      aria-invalid={invalid}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * int and decimal: text input so decimals stay strings (ADR-0010); right-aligned monospace. A decimal keeps its raw
 * string while focused and shows the display form (lib/format.ts AC-8: minimum digits, thousands separators) at rest,
 * so what the user types is exactly what is sent. The swap to the raw string happens in the DOM inside the focus event:
 * left to React's (microtask) re-render it replaced "1,100" after a select-all had been made on it, collapsing the
 * selection so the next keystroke appended ("11001") — found by e2e/payment.spec.ts.
 */
export function NumberField({ id, field, value, onChange, disabled, invalid, ariaLabel }: WidgetProps) {
  const [focused, setFocused] = useState(false);
  const currencyScale = useCurrencyScale();
  const raw = str(value);
  const shown =
    focused || field.kind !== 'decimal' ? raw : formatDecimalInput(raw, decimalMinScale(field, currencyScale));
  const onFocus = (e: FocusEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    if (el.value !== raw) {
      const whole = el.value.length > 0 && el.selectionStart === 0 && el.selectionEnd === el.value.length;
      el.value = raw;
      if (whole) el.select();
    }
    setFocused(true);
  };
  return (
    <input
      id={id}
      name={field.name}
      type="text"
      inputMode={field.kind === 'int' ? 'numeric' : 'decimal'}
      className={cls(invalid, 'num')}
      value={shown}
      data-raw={field.kind === 'decimal' ? raw : undefined}
      disabled={disabled}
      required={field.required}
      aria-invalid={invalid}
      aria-label={ariaLabel}
      placeholder={field.kind === 'decimal' ? '0' : undefined}
      onFocus={onFocus}
      onBlur={() => setFocused(false)}
      // Pasted "1,234,567" (or a change event on the formatted value) is accepted: ja/en both use "." as the decimal point.
      onChange={(e) => onChange(field.kind === 'decimal' ? e.target.value.replace(/,/g, '') : e.target.value)}
      autoComplete="off"
    />
  );
}

export function BoolField({ id, field, value, onChange, disabled, ariaLabel }: WidgetProps) {
  return (
    <input
      id={id}
      name={field.name}
      type="checkbox"
      className="h-4 w-4 accent-sky-700"
      checked={value === true}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

export function DateField({ id, field, value, onChange, disabled, invalid, ariaLabel }: WidgetProps) {
  return (
    <input
      id={id}
      name={field.name}
      type="date"
      className={cls(invalid, 'font-mono')}
      value={str(value)}
      disabled={disabled}
      required={field.required}
      aria-invalid={invalid}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function TimestampField({ id, field, value, ariaLabel }: WidgetProps) {
  const { locale, t } = useLocale();
  const s = str(value);
  return (
    <input
      id={id}
      name={field.name}
      type="text"
      className="input font-mono"
      value={s ? formatTimestamp(s, locale) : ''}
      readOnly
      disabled
      title={t(S.readonly)}
      aria-label={ariaLabel}
    />
  );
}

export function EnumField({ id, field, value, onChange, disabled, invalid, ariaLabel }: WidgetProps) {
  const { t } = useLocale();
  return (
    <select
      id={id}
      name={field.name}
      className={cls(invalid)}
      value={str(value)}
      disabled={disabled}
      required={field.required}
      aria-invalid={invalid}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{t(S.selectNone)}</option>
      {(field.values ?? []).map((v) => (
        <option key={v} value={v}>
          {t(field.valueLabels?.[v], v)}
        </option>
      ))}
    </select>
  );
}

export function JsonField({ id, field, value, onChange, disabled, invalid, ariaLabel }: WidgetProps) {
  const { t } = useLocale();
  return (
    <textarea
      id={id}
      name={field.name}
      rows={4}
      spellCheck={false}
      placeholder={t(S.jsonHint)}
      className={cls(invalid, 'font-mono text-xs')}
      value={str(value)}
      disabled={disabled}
      aria-invalid={invalid}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
