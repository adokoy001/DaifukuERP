import { useState } from 'react';
import { getCompanyId } from '../api/client.ts';
import { useMeta } from '../api/queries.ts';
import { useApplyPack, useCompanies, usePacks, type PackItem } from '../api/templates.ts';
import type { AppMeta } from '../api/types.ts';
import { ActionConfirm } from '../components/action-confirm.tsx';
import { CompanyPicker } from '../components/company-picker.tsx';
import { Icon } from '../components/icon.tsx';
import { useToast } from '../components/toast.tsx';
import { WorkflowLink } from '../components/workflow-link.tsx';
import { useLocale } from '../i18n.tsx';
import { templateOrder, templateStory } from '../lib/templates.ts';
import { LoadingView, MetaError } from './status-views.tsx';

function TemplateCard({
  pack,
  meta,
  busy,
  onApply,
}: {
  pack: PackItem;
  meta: AppMeta;
  busy: boolean;
  onApply: (pack: PackItem, sample: boolean) => void;
}) {
  const { t } = useLocale();
  const [sample, setSample] = useState(false);
  const story = templateStory(pack.name);
  const menus = meta.modules.find((m) => m.name === pack.name)?.menus ?? [];
  const admin = meta.roles.includes('admin');
  const sampleAvailable = pack.hasSample && !pack.sampledAt;
  return (
    <article className={`template-card tone-${story.tone}`} data-testid={`template-${pack.name}`}>
      <div className="template-card-heading">
        <span className="template-symbol">
          <Icon name={story.icon} size={30} />
        </span>
        <span className={`template-badge ${pack.applied ? 'is-applied' : ''}`}>
          {t(pack.applied ? { ja: '利用中', en: 'Active' } : { ja: '導入できます', en: 'Available' })}
        </span>
      </div>
      <h2>{t(pack.label)}</h2>
      <h3>{t(story.headline)}</h3>
      <p>{t(story.description)}</p>
      {story.boundary ? <p className="template-boundary">{t(story.boundary)}</p> : null}
      <ol className="template-steps">
        {story.steps.map((step, i) => (
          <li key={step.en}>
            <b>{i + 1}</b>
            {t(step)}
          </li>
        ))}
      </ol>
      {pack.applied && menus.length ? (
        <div className="template-workflows">
          {menus.map((item) => (
            <WorkflowLink key={item.entity ?? item.route} item={item} />
          ))}
        </div>
      ) : null}
      <footer>
        {admin && sampleAvailable ? (
          <label className="template-sample">
            <input type="checkbox" checked={sample} disabled={busy} onChange={(e) => setSample(e.target.checked)} />
            {t({ ja: 'サンプルデータも追加する', en: 'Include sample data' })}
          </label>
        ) : null}
        {admin && (!pack.applied || (sampleAvailable && sample)) ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !getCompanyId()}
            onClick={() => onApply(pack, sample)}
          >
            {t(
              pack.applied
                ? { ja: 'サンプルを追加', en: 'Add sample data' }
                : { ja: 'この会社に導入', en: 'Apply to this company' },
            )}
            <Icon name="arrow" size={16} />
          </button>
        ) : null}
        {!admin && !pack.applied ? (
          <span>{t({ ja: '導入は管理者が行えます', en: 'An administrator can apply this template' })}</span>
        ) : null}
        {pack.sampledAt ? <small>{t({ ja: 'サンプル追加済み', en: 'Sample data added' })}</small> : null}
      </footer>
    </article>
  );
}

export function TemplatesPage() {
  const { t } = useLocale();
  const meta = useMeta();
  const packs = usePacks();
  const companies = useCompanies();
  const apply = useApplyPack();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [pending, setPending] = useState<{ pack: PackItem; sample: boolean }>();
  const company = companies.data?.items.find((c) => c.id === companies.data.companyId);
  const confirm = () => {
    if (!pending || apply.isPending) return;
    const input = { name: pending.pack.name, sample: pending.sample };
    setPending(undefined);
    apply.mutate(input, {
      onSuccess: () => toast.success(t({ ja: 'テンプレートを適用しました', en: 'Template applied' })),
      onError: (err) => toast.error(err),
    });
  };
  if (meta.isError) return <MetaError error={meta.error} retry={() => void meta.refetch()} />;
  if (packs.isError)
    return (
      <div className="workspace-page templates-page">
        <CompanyPicker disabled={false} />
        <MetaError error={packs.error} retry={() => void packs.refetch()} />
      </div>
    );
  if (!meta.data || !packs.data) return <LoadingView />;
  const items = [...packs.data.items].sort((a, b) => {
    const rank = (name: string) => {
      const i = templateOrder.indexOf(name);
      return i < 0 ? templateOrder.length : i;
    };
    return rank(a.name) - rank(b.name);
  });
  const query = search.trim().toLocaleLowerCase();
  const visible = items.filter((pack) => {
    const story = templateStory(pack.name);
    return (
      (status === 'all' || pack.applied === (status === 'active')) &&
      [pack.name, t(pack.label), t(story.description)].join(' ').toLocaleLowerCase().includes(query)
    );
  });
  return (
    <div className="workspace-page templates-page">
      <header className="template-hero">
        <div>
          <span className="eyebrow">BUILT FOR YOUR BUSINESS</span>
          <h1>{t({ ja: 'あなたの仕事に、ぴったりの入口を。', en: 'A workspace shaped around your business.' })}</h1>
          <p>
            {t({
              ja: '業界の流れに合わせた設定と専用メニュー。共通の会計・販売・在庫につながります。',
              en: 'Industry workflows connected to shared accounting, sales and inventory.',
            })}
          </p>
        </div>
        <span className="template-hero-symbol">
          <Icon name="spark" size={54} />
        </span>
      </header>
      <div className="template-toolbar">
        <CompanyPicker disabled={apply.isPending || pending !== undefined} />
        <p>
          {t({
            ja: '選択中の会社に適用します。保存済み設定は維持されます。',
            en: 'Templates apply to the selected company. Existing settings are preserved.',
          })}
        </p>
      </div>
      <div className="template-filters">
        <label>
          {t({ ja: '業界を探す', en: 'Find an industry' })}
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t({ ja: '業種名・業務内容', en: 'Industry or workflow' })}
          />
        </label>
        <label>
          {t({ ja: '利用状況', en: 'Template status' })}
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">{t({ ja: 'すべて', en: 'All' })}</option>
            <option value="active">{t({ ja: '利用中', en: 'Active' })}</option>
            <option value="available">{t({ ja: '未導入', en: 'Available' })}</option>
          </select>
        </label>
        <span>
          {t({
            ja: `利用できる業界テンプレート ${items.filter((item) => item.name !== 'example').length} 種`,
            en: `${items.filter((item) => item.name !== 'example').length} industry templates available`,
          })}
        </span>
      </div>
      {visible.length === 0 ? (
        <p role="status" className="template-note">
          {t({
            ja: '条件に合う業界がありません。検索条件を変更してください。',
            en: 'No templates match. Change the filters.',
          })}
        </p>
      ) : null}
      <div className="template-grid">
        {visible.map((pack) => (
          <TemplateCard
            key={pack.name}
            pack={pack}
            meta={meta.data}
            busy={apply.isPending || pending !== undefined || !company}
            onApply={(p, sample) => setPending({ pack: p, sample })}
          />
        ))}
      </div>
      <p className="template-note">
        {t({
          ja: '国内・円建ての業務を想定した初版です。サンプルは練習用のデータとして会社ごとに一度追加できます。',
          en: 'Initial templates for domestic JPY workflows. Practice data can be added once per company.',
        })}
      </p>
      {pending ? (
        <ActionConfirm
          title={t({ ja: 'テンプレートを適用', en: 'Apply template' })}
          message={`${company?.name ?? ''}：${t(pending.pack.label)}。${t(pending.sample ? { ja: 'サンプルデータも追加します。', en: 'Sample data will also be added.' } : { ja: '初期設定と必要なマスタを追加します。', en: 'Initial settings and master records will be added.' })}`}
          cancelDocument={false}
          destructive={false}
          onConfirm={confirm}
          onClose={() => setPending(undefined)}
        />
      ) : null}
    </div>
  );
}
