// Label + widget + error for one field; dispatches on widgetFor(field) (AC-4).
import type { FieldMeta } from '../../api/types.ts';
import { useLocale } from '../../i18n.tsx';
import { widgetFor, type FormValue, type Widget } from '../../lib/form.ts';
import { S } from '../../strings.ts';
import { BoolField, DateField, EnumField, JsonField, NumberField, TextAreaField, TextField, TimestampField, type WidgetProps } from './inputs.tsx';
import { RefField } from './ref-field.tsx';
import { TaxSummary } from '../tax-summary.tsx';

/** Bare widgets by kind; the line grid (line-grid.tsx) renders them without labels. */
export const WIDGETS: Record<Widget, (p: WidgetProps) => React.JSX.Element> = {
  text: TextField,
  textarea: TextAreaField,
  int: NumberField,
  decimal: NumberField,
  bool: BoolField,
  date: DateField,
  timestamp: TimestampField,
  enum: EnumField,
  ref: RefField,
  json: JsonField,
};

export interface FieldWidgetProps {
  field: FieldMeta;
  value: FormValue;
  onChange: (v: FormValue) => void;
  disabled: boolean;
  error: string | undefined;
  /** Element id prefix (default `f`); schema forms that repeat property names on one page pass their own. */
  idPrefix?: string;
}

/** Column span hint so long text/JSON widgets take the full row of the form grid. */
export function widgetSpan(field: FieldMeta): 'full' | 'normal' {
  const w = widgetFor(field);
  return w === 'textarea' || w === 'json' ? 'full' : 'normal';
}

export function FieldWidget({ field, value, onChange, disabled, error, idPrefix }: FieldWidgetProps) {
  const { t } = useLocale();
  const widget = widgetFor(field);
  const Widget = WIDGETS[widget];
  const id = `${idPrefix ?? 'f'}-${field.name}`;
  const invalid = error !== undefined;
  const label = (
    <label htmlFor={id} className="text-xs font-medium text-neutral-700">
      {t(field.label)}
      {field.required && !field.hasDefault && !disabled ? (
        <span className="ml-0.5 text-red-600" title={t(S.required)}>
          *
        </span>
      ) : null}
      {field.immutable && disabled ? <span className="ml-1 text-[10px] text-neutral-400">🔒</span> : null}
    </label>
  );
  if (widget === 'bool') {
    return (
      <div data-field={field.name} className="flex items-center gap-2 pt-4">
        <Widget id={id} field={field} value={value} onChange={onChange} disabled={disabled} invalid={invalid} />
        {label}
        {error ? <span className="text-xs text-red-700">{error}</span> : null}
      </div>
    );
  }
  return (
    <div data-field={field.name} className={`flex flex-col gap-0.5 ${widgetSpan(field) === 'full' ? 'col-span-full' : ''}`}>
      {label}
      {widget === 'json' && field.name === 'taxSummary' && disabled ? <TaxSummary id={id} value={value} /> : <Widget id={id} field={field} value={value} onChange={onChange} disabled={disabled} invalid={invalid} />}
      {error ? (
        <span role="alert" data-testid={`error-${field.name}`} className="text-xs text-red-700">
          {error}
        </span>
      ) : field.description ? (
        <span className="text-[11px] text-neutral-500">{t(field.description)}</span>
      ) : null}
    </div>
  );
}
