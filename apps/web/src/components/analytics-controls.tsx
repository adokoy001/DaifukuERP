import type { AnalyticsDataset } from '../api/analytics.ts';
import { useLocale } from '../i18n.tsx';
import { GRAIN_LABELS, OP_LABELS } from '../lib/analytics.ts';
import type { PivotAxis, PivotConfig, PivotMeasure } from '../lib/pivot.ts';

function AxisEditor({
  name,
  axes,
  dataset,
  onChange,
}: {
  name: string;
  axes: PivotAxis[];
  dataset: AnalyticsDataset;
  onChange(value: PivotAxis[]): void;
}) {
  const { t } = useLocale();
  const update = (index: number, axis: PivotAxis) => onChange(axes.map((item, at) => (at === index ? axis : item)));
  const move = (index: number, by: number) => {
    const copy = [...axes];
    const current = copy[index];
    const other = copy[index + by];
    if (current && other) {
      copy[index] = other;
      copy[index + by] = current;
      onChange(copy);
    }
  };
  return (
    <fieldset className="analytics-axis">
      <legend>
        {name} <small>{t({ ja: '上から順に階層化', en: 'Top to bottom hierarchy' })}</small>
      </legend>
      {axes.map((axis, index) => (
        <div className="analytics-axis-item" key={index}>
          <span className="analytics-step">{index + 1}</span>
          <select
            className="input"
            aria-label={`${name} ${index + 1}`}
            value={axis.field}
            onChange={(event) =>
              update(index, {
                field: event.target.value,
                grain:
                  dataset.dimensions.find((field) => field.key === event.target.value)?.kind === 'date'
                    ? 'month'
                    : 'value',
              })
            }
          >
            {dataset.dimensions.map((field) => (
              <option key={field.key} value={field.key}>
                {t(field.label)}
              </option>
            ))}
          </select>
          {dataset.dimensions.find((field) => field.key === axis.field)?.kind === 'date' ? (
            <select
              className="input grain-input"
              aria-label={`${name} ${index + 1} ${t({ ja: '日付の粒度', en: 'Date grouping' })}`}
              value={axis.grain ?? 'value'}
              onChange={(event) =>
                update(index, { ...axis, grain: event.target.value as NonNullable<PivotAxis['grain']> })
              }
            >
              {Object.entries(GRAIN_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {t(label)}
                </option>
              ))}
            </select>
          ) : null}
          <button
            className="btn icon-button"
            type="button"
            disabled={index === 0}
            aria-label={`${name} ${index + 1} ${t({ ja: '上へ', en: 'Move up' })}`}
            onClick={() => move(index, -1)}
          >
            ↑
          </button>
          <button
            className="btn icon-button"
            type="button"
            disabled={index === axes.length - 1}
            aria-label={`${name} ${index + 1} ${t({ ja: '下へ', en: 'Move down' })}`}
            onClick={() => move(index, 1)}
          >
            ↓
          </button>
          <button
            className="btn icon-button"
            type="button"
            aria-label={`${name} ${index + 1} ${t({ ja: '削除', en: 'Remove' })}`}
            onClick={() => onChange(axes.filter((_, at) => index !== at))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        className="btn"
        type="button"
        disabled={axes.length >= 3 || !dataset.dimensions.length}
        onClick={() => {
          const field =
            dataset.dimensions.find((item) => !axes.some((axis) => axis.field === item.key)) ?? dataset.dimensions[0];
          if (field) onChange([...axes, { field: field.key, grain: field.kind === 'date' ? 'month' : 'value' }]);
        }}
      >
        ＋ {t({ ja: '階層を追加', en: 'Add level' })}
      </button>
    </fieldset>
  );
}
export function AnalyticsControls({
  dataset,
  value,
  onChange,
}: {
  dataset: AnalyticsDataset;
  value: PivotConfig;
  onChange(value: PivotConfig): void;
}) {
  const { t } = useLocale();
  return (
    <div className="analytics-config-grid">
      <AxisEditor
        name={t({ ja: '行', en: 'Rows' })}
        axes={value.rows}
        dataset={dataset}
        onChange={(rows) => onChange({ ...value, rows })}
      />
      <AxisEditor
        name={t({ ja: '列', en: 'Columns' })}
        axes={value.columns}
        dataset={dataset}
        onChange={(columns) => onChange({ ...value, columns })}
      />
      <fieldset className="analytics-axis analytics-measures">
        <legend>
          {t({ ja: '指標', en: 'Measures' })} <small>{t({ ja: '最大3種類', en: 'Up to 3 measures' })}</small>
        </legend>
        {value.measures.map((measure, index) => (
          <div className="analytics-axis-item" key={index}>
            <select
              className="input"
              aria-label={`${t({ ja: '指標', en: 'Measure' })} ${index + 1}`}
              value={measure.field}
              onChange={(event) =>
                onChange({
                  ...value,
                  measures: value.measures.map((item, at) =>
                    at === index ? { ...item, field: event.target.value } : item,
                  ),
                })
              }
            >
              {dataset.measures.map((field) => (
                <option key={field.key} value={field.key}>
                  {t(field.label)}
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label={`${t({ ja: '集計方法', en: 'Aggregation' })} ${index + 1}`}
              value={measure.op}
              onChange={(event) =>
                onChange({
                  ...value,
                  measures: value.measures.map((item, at) =>
                    at === index ? { ...item, op: event.target.value as PivotMeasure['op'] } : item,
                  ),
                })
              }
            >
              {Object.entries(OP_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {t(label)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn icon-button"
              disabled={value.measures.length === 1}
              aria-label={`${t({ ja: '指標を削除', en: 'Remove measure' })} ${index + 1}`}
              onClick={() => onChange({ ...value, measures: value.measures.filter((_, at) => at !== index) })}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn"
          disabled={value.measures.length >= 3}
          onClick={() =>
            onChange({ ...value, measures: [...value.measures, { field: dataset.defaultMeasure, op: 'rows' }] })
          }
        >
          ＋ {t({ ja: '指標を追加', en: 'Add measure' })}
        </button>
      </fieldset>
    </div>
  );
}
