import type { ReactNode } from 'react';
import type { Label } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { Icon, type IconName } from './icon.tsx';

export function WorkforceHero({
  title,
  description,
  name,
  site,
  side,
  management = false,
}: {
  title: string;
  description: string;
  name?: string;
  site?: string;
  side?: ReactNode;
  management?: boolean;
}) {
  return (
    <header className="workforce-hero">
      <div>
        <span className="eyebrow">{management ? 'PEOPLE OPERATIONS' : 'MY WORKDAY'}</span>
        <h1>{title}</h1>
        <p>{description}</p>
        {name ? (
          <div className="workforce-person">
            <span className="user-avatar">{name.slice(0, 1)}</span>
            <div>
              <strong>{name}</strong>
              {site ? <small>{site}</small> : null}
            </div>
          </div>
        ) : null}
      </div>
      {side ? <div className="workforce-hero-side">{side}</div> : null}
    </header>
  );
}

export interface WorkforceTab {
  id: string;
  label: Label;
  icon: IconName;
}
export function WorkforceTabs({
  tabs,
  selected,
  onSelect,
}: {
  tabs: WorkforceTab[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  const { t } = useLocale();
  return (
    <nav className="workforce-tabs" aria-label={t({ ja: '従業員業務', en: 'Employee tasks' })}>
      {tabs.map((tab) => (
        <button type="button" key={tab.id} aria-pressed={selected === tab.id} onClick={() => onSelect(tab.id)}>
          <Icon name={tab.icon} />
          <span>{t(tab.label)}</span>
        </button>
      ))}
    </nav>
  );
}

export function WorkforceMetric({
  title,
  value,
  note,
  icon,
  tone,
}: {
  title: string;
  value: ReactNode;
  note: string;
  icon: IconName;
  tone?: 'cyan' | 'coral';
}) {
  return (
    <article className="workforce-metric" data-tone={tone}>
      <span>
        <Icon name={icon} size={17} />
        {title}
      </span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}
