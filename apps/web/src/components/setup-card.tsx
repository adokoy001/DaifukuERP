// "Continue setup" on the home screen (docs/specs/setup-wizard.md AC-7): for every session whose /meta roles include
// admin, whichever home view it uses, while a required step is todo or some check fails. Non-admins never request
// GET /meta/setup-status (no 403 on their home). A failed read shows nothing here and never disturbs the rest of home.
import { Link } from '@tanstack/react-router';
import { useMeta } from '../api/queries.ts';
import { useSetupStatus } from '../api/setup.ts';
import { useLocale } from '../i18n.tsx';
import { cardTarget, isAdminRoles, progressText, showSetupCard } from '../lib/setup-wizard.ts';
import { Badge, buttonClass, Card } from '../ui/index.ts';
import { Icon } from './icon.tsx';

export function SetupCard() {
  const { t } = useLocale();
  const meta = useMeta();
  const admin = isAdminRoles(meta.data?.roles);
  const status = useSetupStatus(admin);
  if (!admin || !status.data || status.isError || !showSetupCard(status.data)) return null;
  const data = status.data;
  const target = cardTarget(data);
  const next = data.steps.find((step) => step.id === target);
  const failing = data.steps.filter((step) => data.summary.attention.includes(step.id));
  return (
    <Card data-testid="setup-card" aria-labelledby="setup-card-title" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="icon-tile">
          <Icon name="settings" />
        </span>
        <h2 id="setup-card-title" className="text-base font-semibold text-text">
          {t({ ja: 'セットアップを続ける', en: 'Continue setup' })}
        </h2>
        <Badge tone="accent" data-testid="setup-card-progress">
          {t(progressText(data.summary))}
        </Badge>
      </div>
      {next ? (
        <p className="text-sm text-text-secondary" data-testid="setup-card-next">
          {t({ ja: '次の段階: ', en: 'Next step: ' })}
          <strong className="text-text">{t(next.label)}</strong>
        </p>
      ) : null}
      {failing.length > 0 ? (
        <p className="ui-notice ui-notice-warning text-sm" data-testid="setup-card-attention">
          {t({
            ja: '点検に失敗している段階があります（伝票を確定できない状態です）: ',
            en: 'Some steps have failing checks (documents cannot be submitted): ',
          })}
          {failing.map((step) => t(step.label)).join(t({ ja: '、', en: ', ' }))}
        </p>
      ) : null}
      {target ? (
        <div>
          <Link
            to="/setup"
            search={{ step: target }}
            className={buttonClass('primary', 'sm')}
            data-testid="setup-card-link"
          >
            {t({ ja: 'セットアップを開く', en: 'Open setup' })}
            <Icon name="arrow" size={16} />
          </Link>
        </div>
      ) : null}
    </Card>
  );
}
