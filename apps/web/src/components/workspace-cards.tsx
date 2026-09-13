import { Link } from '@tanstack/react-router';
import { useLocale } from '../i18n.tsx';
import type { NavigationEntry, NavigationWorkspace, WorkspaceId } from '../lib/navigation.ts';
import { Icon, type IconName } from './icon.tsx';

export const WORKSPACE_ICONS: Record<WorkspaceId, IconName> = {
  sales: 'document',
  inventory: 'box',
  workforce: 'people',
  finance: 'wallet',
  operations: 'building',
  reports: 'chart',
  admin: 'settings',
  other: 'spark',
};

export function WorkspaceCards({ workspaces }: { workspaces: NavigationWorkspace[] }) {
  const { t } = useLocale();
  return (
    <div className="workspace-grid">
      {workspaces.map((workspace) => (
        <Link
          key={workspace.id}
          to="/workspaces/$workspace"
          params={{ workspace: workspace.id }}
          className={`workspace-tile workspace-${workspace.id}`}
          data-testid="workspace-card"
        >
          <span className="workspace-tile-icon">
            <Icon name={WORKSPACE_ICONS[workspace.id]} size={25} />
          </span>
          <span className="workspace-tile-content">
            <strong>{t(workspace.label)}</strong>
            <span>{t(workspace.description)}</span>
            <small>
              {workspace.entries.length} {t({ ja: '画面', en: 'screens' })}
            </small>
          </span>
          <Icon name="arrow" size={18} />
        </Link>
      ))}
    </div>
  );
}

export function ScreenCard({ entry, featured = false }: { entry: NavigationEntry; featured?: boolean }) {
  const { t } = useLocale();
  return (
    <Link
      to={entry.href}
      className={`screen-card ${featured ? 'is-featured' : ''}`}
      data-screen-href={entry.href}
      data-testid={entry.href === '/settings' ? 'nav-settings' : undefined}
    >
      <Icon
        name={
          featured
            ? WORKSPACE_ICONS[entry.workspace]
            : entry.kind === 'report'
              ? 'chart'
              : entry.kind === 'setting'
                ? 'settings'
                : 'document'
        }
        size={21}
      />
      <span>
        <strong>{t(entry.label)}</strong>
        {entry.description ? <small>{t(entry.description)}</small> : null}
      </span>
      <Icon name="arrow" size={16} />
    </Link>
  );
}
