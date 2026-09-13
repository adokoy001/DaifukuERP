import { useLocale } from '../i18n.tsx';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Show saved rule identifiers only, without exposing the personnel snapshot or recalculating it. */
export function FiscalRuleEvidence({
  selection,
  savedRule,
  annual = false,
}: {
  selection: unknown;
  savedRule: unknown;
  annual?: boolean;
}) {
  const { t } = useLocale(),
    chosen = object(selection),
    data = object(object(savedRule).data);
  const code = typeof chosen.packageCode === 'string' ? chosen.packageCode : data.code;
  const method =
    typeof chosen.algorithmVersion === 'string'
      ? chosen.algorithmVersion
      : data[annual ? 'annualMethod' : 'monthlyMethod'];
  const taxYear = chosen.taxYear ?? data.taxYear;
  if (typeof code !== 'string') return null;
  return (
    <details className="fiscal-evidence">
      <summary>{t({ ja: '計算時に保存した制度版', en: 'Rule version saved with this calculation' })}</summary>
      <dl className="workforce-definition">
        <div>
          <dt>{t({ ja: '制度版', en: 'Rule package' })}</dt>
          <dd>{code}</dd>
        </div>
        {typeof taxYear === 'number' ? (
          <div>
            <dt>{t({ ja: '税年', en: 'Tax year' })}</dt>
            <dd>{taxYear}</dd>
          </div>
        ) : null}
        {typeof method === 'string' ? (
          <div>
            <dt>{t({ ja: '計算方式', en: 'Calculation method' })}</dt>
            <dd>{method}</dd>
          </div>
        ) : null}
        {typeof chosen.payloadHash === 'string' ? (
          <div>
            <dt>{t({ ja: '制度データのhash', en: 'Payload hash' })}</dt>
            <dd>{chosen.payloadHash}</dd>
          </div>
        ) : null}
        {typeof chosen.manifestHash === 'string' ? (
          <div>
            <dt>{t({ ja: '版情報のhash', en: 'Manifest hash' })}</dt>
            <dd>{chosen.manifestHash}</dd>
          </div>
        ) : null}
      </dl>
      <p className="account-help">
        {t({
          ja: '保存当時の計算根拠です。現在の制度版で再計算した結果ではありません。',
          en: 'This is the evidence saved at calculation time. The result has not been recalculated using current rules.',
        })}
      </p>
    </details>
  );
}
