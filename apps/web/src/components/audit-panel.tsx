// AC-6: audit trail of one record (op, actor, at, changed fields). web-polish: each change shows `label: before → after`
// through the same display rules as cells (decimals by scale), so "100.000000" reads "100" here too.
import { useCurrencyScale } from '../api/company.tsx';
import { useAudit } from '../api/queries.ts';
import type { AuditEntry, EntityMeta } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { changeValueText, fieldChanges, formatTimestamp, shortId } from '../lib/format.ts';
import { S } from '../strings.ts';

function actorText(e: AuditEntry): string {
  const base = `${e.actorType}:${shortId(e.actorId)}`;
  return e.onBehalfOf ? `${base} (for ${shortId(e.onBehalfOf)})` : base;
}

function Changes({ entity, entry }: { entity: EntityMeta; entry: AuditEntry }) {
  const { t, locale } = useLocale();
  const currencyScale = useCurrencyScale();
  const changes = fieldChanges(entry);
  if (changes.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
      {changes.map((c) => {
        const field = entity.fields.find((f) => f.name === c.name);
        const after = changeValueText(field, c.after, locale, { currencyScale });
        return (
          <li key={c.name} data-change={c.name} className="whitespace-nowrap">
            <span className="text-neutral-600">{t(field?.label, c.name)}</span>
            {entry.op === 'create' ? (
              <span className="ml-1 font-mono">{after}</span>
            ) : (
              <>
                <span className="ml-1 font-mono text-neutral-400 line-through">
                  {changeValueText(field, c.before, locale, { currencyScale })}
                </span>
                <span className="mx-0.5 text-neutral-400">→</span>
                <span className="font-mono">{after}</span>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function AuditPanel({ entity, id }: { entity: EntityMeta; id: string }) {
  const { t, locale } = useLocale();
  const audit = useAudit(entity.name, id);
  return (
    <section aria-label={t(S.audit)} data-testid="audit-panel" className="rounded border border-neutral-200 bg-white">
      <h2 className="border-b border-neutral-200 px-3 py-1.5 text-sm font-semibold">
        {t(S.audit)}
        {audit.data ? <span className="ml-2 text-xs font-normal text-neutral-500">({audit.data.length})</span> : null}
      </h2>
      {audit.isPending ? <div className="px-3 py-2 text-xs text-neutral-500">{t(S.loading)}</div> : null}
      {audit.isError ? <div className="px-3 py-2 text-xs text-red-700">{t(S.loadFailed)}</div> : null}
      {audit.data && audit.data.length === 0 ? (
        <div className="px-3 py-2 text-xs text-neutral-500">{t(S.auditEmpty)}</div>
      ) : null}
      {audit.data && audit.data.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50 text-left text-neutral-600">
              <tr>
                <th className="px-3 py-1 font-medium">{t(S.auditAt)}</th>
                <th className="px-3 py-1 font-medium">{t(S.auditOp)}</th>
                <th className="px-3 py-1 font-medium">{t(S.auditActor)}</th>
                <th className="px-3 py-1 font-medium">{t(S.auditChanged)}</th>
              </tr>
            </thead>
            <tbody>
              {audit.data.map((e) => (
                <tr key={e.id} data-testid="audit-entry" className="border-t border-neutral-100 align-top">
                  <td className="px-3 py-1 font-mono whitespace-nowrap">{formatTimestamp(e.at, locale)}</td>
                  <td className="px-3 py-1">
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono">{e.op}</span>
                    {e.action ? <span className="ml-1 text-neutral-500">{e.action}</span> : null}
                  </td>
                  <td className="px-3 py-1 font-mono whitespace-nowrap">{actorText(e)}</td>
                  <td className="px-3 py-1">
                    <Changes entity={entity} entry={e} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
