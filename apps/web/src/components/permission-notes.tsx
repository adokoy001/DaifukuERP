// access-insight AC-6: the opened row of the permission matrix — row-rule summaries (with the operations each rule
// narrows), restricted fields, what a store- or site-limited membership may do per role, the site device operations,
// and named transitions with the roles that can run them. Everything shown comes from GET /admin/permissions.
import type { Label } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import {
  cellText,
  OP_TEXT,
  policyText,
  submitNote,
  type MatrixEntity,
  type MatrixRole,
  type MatrixScopeNote,
} from '../lib/permission-matrix.ts';
import { Badge } from '../ui/index.ts';

function roleNames(names: readonly string[], roles: readonly MatrixRole[], t: (l: Label) => string): string {
  return names.map((name) => t(roles.find((r) => r.name === name)?.label ?? { ja: name, en: name })).join(' / ');
}

function ScopeNote({
  title,
  note,
  roles,
  role,
}: {
  title: Label;
  note: MatrixScopeNote;
  roles: readonly MatrixRole[];
  role: string | undefined;
}) {
  const { t, locale } = useLocale();
  const shown = roles.filter((r) => (role ? r.name === role : (note.effective[r.name] ?? []).length > 0));
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-sm font-semibold text-text">{t(title)}</h4>
      <p className="text-sm text-text-secondary">{t(policyText(note.policy))}</p>
      {note.policy ? (
        <ul className="flex flex-col gap-0.5 text-sm">
          {shown.map((r) => {
            const ops = cellText(note.effective[r.name] ?? [], locale);
            return (
              <li key={r.name}>
                <span className="font-semibold">{t(r.label)}</span>: {ops.full}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function PermissionNotes({
  entity,
  roles,
  role,
}: {
  entity: MatrixEntity;
  roles: readonly MatrixRole[];
  role: string | undefined;
}) {
  const { t, locale } = useLocale();
  const rules = role ? entity.rowRules.filter((r) => r.roles.includes(role)) : entity.rowRules;
  const submit = submitNote(entity);
  return (
    <div className="grid gap-4 py-2 md:grid-cols-2" data-testid={`permission-notes-${entity.name}`}>
      <section className="flex flex-col gap-1" aria-label={t({ ja: '行ルール', en: 'Row rules' })}>
        <h4 className="text-sm font-semibold text-text">{t({ ja: '行ルール', en: 'Row rules' })}</h4>
        {rules.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {rules.map((rule, index) => (
              <li key={index} data-testid="row-rule">
                <span className="font-semibold">{roleNames(rule.roles, roles, t)}</span>:{' '}
                <span data-testid="row-rule-summary">{t(rule.summary)}</span>{' '}
                <Badge tone="accent">
                  {rule.self
                    ? t({ ja: '自分の行のみ', en: 'Own rows only' })
                    : t({ ja: '条件付き', en: 'Conditional' })}
                </Badge>
                <span className="block text-xs text-text-muted">
                  {t({ ja: '制限する操作', en: 'Narrows' })}:{' '}
                  {Object.entries(rule.restrictedOps)
                    .filter(([name]) => !role || name === role)
                    .map(([name, ops]) => `${roleNames([name], roles, t)} — ${cellText(ops, locale).full}`)
                    .join(locale === 'ja' ? '、' : '; ')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-secondary">{t({ ja: '行ルールはありません。', en: 'No row rules.' })}</p>
        )}
      </section>
      <section className="flex flex-col gap-1" aria-label={t({ ja: '項目の制限', en: 'Restricted fields' })}>
        <h4 className="text-sm font-semibold text-text">{t({ ja: '項目の制限', en: 'Restricted fields' })}</h4>
        {entity.fieldGroups.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {entity.fieldGroups.map((group) => (
              <li key={group.name}>
                {group.fields.map((f) => t(f.label)).join(locale === 'ja' ? '、' : ', ')}
                {' — '}
                {t({ ja: '読めるロール', en: 'Readable by' })}: {roleNames(group.roles, roles, t)}
                {t({ ja: '（admin を含む）', en: ' (and admin)' })}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-secondary">
            {t({ ja: '項目の制限はありません。', en: 'No restricted fields.' })}
          </p>
        )}
      </section>
      <ScopeNote
        title={{ ja: '店舗限定の所属', en: 'Store-limited membership' }}
        note={entity.stores}
        roles={roles}
        role={role}
      />
      <ScopeNote
        title={{ ja: '拠点限定の所属', en: 'Site-limited membership' }}
        note={entity.sites}
        roles={roles}
        role={role}
      />
      <section className="flex flex-col gap-1" aria-label={t({ ja: '店舗端末', en: 'Site device' })}>
        <h4 className="text-sm font-semibold text-text">{t({ ja: '店舗端末', en: 'Site device' })}</h4>
        <p className="text-sm text-text-secondary">
          {entity.relay
            ? `${t({ ja: '端末が行える操作', en: 'Device operations' })}: ${cellText(entity.relay.effective, locale).full}`
            : t({ ja: '店舗端末からは使えません。', en: 'Not available to site devices.' })}
        </p>
      </section>
      <section className="flex flex-col gap-1" aria-label={t({ ja: '名前付き遷移', en: 'Named transitions' })}>
        <h4 className="text-sm font-semibold text-text">{t({ ja: '名前付き遷移', en: 'Named transitions' })}</h4>
        {entity.transitions.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {entity.transitions.map((tr) => (
              <li key={tr.name} data-testid="transition">
                <span className="font-mono">{tr.name}</span>
                {' — '}
                {t({ ja: '実行できるロール', en: 'Runnable by' })}: {roleNames(tr.runnableRoles, roles, t) || '—'}
                {tr.guard ? t({ ja: '（追加の条件あり）', en: ' (with an extra condition)' }) : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-secondary">
            {t({ ja: '名前付き遷移はありません。', en: 'No named transitions.' })}
          </p>
        )}
        {submit ? (
          <p className="text-sm text-text-secondary">
            {t(OP_TEXT.submit.name)}: {t(submit)}
          </p>
        ) : null}
      </section>
    </div>
  );
}
