// Label + widget + error for one field; dispatches on widgetFor(field) (AC-4).
import type { FieldMeta } from '../../api/types.ts';
import { useLocale } from '../../i18n.tsx';
import { needsInput, widgetFor, type FormValue, type Widget } from '../../lib/form.ts';
import { S } from '../../strings.ts';
import {
  BoolField,
  DateField,
  EnumField,
  JsonField,
  NumberField,
  TextAreaField,
  TextField,
  TimestampField,
  type WidgetProps,
} from './inputs.tsx';
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
  /**
   * Whether the error is its own `role="alert"` (default). The record form passes false: its error summary is the one
   * alert, and each inline error is read with its input through aria-describedby (form-ergonomics AC-3/AC-4).
   */
  alertError?: boolean;
}

/** Column span hint so long text/JSON widgets take the full row of the form grid. */
export function widgetSpan(field: FieldMeta): 'full' | 'normal' {
  const w = widgetFor(field);
  return w === 'textarea' || w === 'json' ? 'full' : 'normal';
}

export function FieldWidget({
  field,
  value,
  onChange,
  disabled,
  error,
  idPrefix,
  alertError = true,
}: FieldWidgetProps) {
  const { t } = useLocale();
  const widget = widgetFor(field);
  const Widget = WIDGETS[widget];
  const id = `${idPrefix ?? 'f'}-${field.name}`;
  const invalid = error !== undefined;
  // form-ergonomics AC-4: the mark and `required` / aria-required say the same thing; the description is helper text
  // tied to the input with aria-describedby (after the error, which is read first).
  const required = needsInput(field, !disabled);
  const errorId = `${id}-error`;
  const descriptionId = `${id}-desc`;
  const describedBy =
    [error ? errorId : '', field.description ? descriptionId : ''].filter(Boolean).join(' ') || undefined;
  const label = (
    <label htmlFor={id} className="text-xs font-medium text-neutral-700">
      {t(field.label)}
      {required ? (
        <span className="ml-0.5 text-red-600" title={t(S.required)} aria-hidden="true">
          *
        </span>
      ) : null}
      {field.immutable && disabled ? <span className="ml-1 text-[10px] text-neutral-400">🔒</span> : null}
    </label>
  );
  const errorNode = error ? (
    <span
      id={errorId}
      role={alertError ? 'alert' : undefined}
      data-testid={`error-${field.name}`}
      className="text-xs text-red-700"
    >
      {error}
    </span>
  ) : null;
  const descriptionNode = field.description ? (
    <span id={descriptionId} className="field-description text-[11px] text-text-muted">
      {t(field.description)}
    </span>
  ) : null;
  const props = { id, field, value, onChange, disabled, invalid, describedBy, required };
  if (widget === 'bool') {
    return (
      <div data-field={field.name} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-4">
        <Widget {...props} />
        {label}
        {errorNode}
        {descriptionNode ? <span className="basis-full">{descriptionNode}</span> : null}
      </div>
    );
  }
  return (
    <div
      data-field={field.name}
      className={`flex flex-col gap-0.5 ${widgetSpan(field) === 'full' ? 'col-span-full' : ''}`}
    >
      {label}
      {widget === 'json' && field.name === 'taxSummary' && disabled ? (
        <TaxSummary id={id} value={value} />
      ) : (
        <Widget {...props} />
      )}
      {errorNode}
      {descriptionNode}
    </div>
  );
}
