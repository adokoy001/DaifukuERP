// Admin home view (docs/specs/role-home.md AC-12): the 「導入・管理」 card with the setup screens of the catalog, then the
// general home. The card is the hook for B3 (setup-health) and B4 (setup-wizard): their links appear once their
// catalog entries exist (lib/role-home.ts adminLinks); nothing of theirs is called or imported here.
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useLocale } from '../i18n.tsx';
import { adminLinks, HOME_LAYOUT_LABELS } from '../lib/role-home.ts';
import { Card } from '../ui/index.ts';
import { Icon } from './icon.tsx';
import { useHomeCardEnv } from './role-home-card.tsx';

export function AdminHome({ general }: { general: ReactNode }) {
  const { t } = useLocale();
  const { catalog } = useHomeCardEnv();
  const links = adminLinks(catalog);
  return (
    <>
      <Card className="role-home-card role-home-admin" aria-labelledby="home-admin-title" data-testid="home-admin">
        <h2 id="home-admin-title">
          <Icon name="settings" size={18} />
          {t(HOME_LAYOUT_LABELS.admin)}
        </h2>
        <p className="role-home-caption">
          {t({
            ja: '会社の設定、利用者と権限、業界テンプレートを確認します。',
            en: 'Review company settings, users and access, and industry templates.',
          })}
        </p>
        {/* B3 (setup-health) / B4 (setup-wizard): their links come from the catalog. The wizard's "continue setup" card
            is SetupCard, mounted by HomePage above the view switch so admins on a business view see it too. */}
        {links.length ? (
          <ul className="role-home-links">
            {links.map((link) => (
              <li key={link.href}>
                <Link to={link.href as never} className="role-home-link" data-testid="home-admin-link">
                  {t(link.label)}
                  <Icon name="arrow" size={14} />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      {general}
    </>
  );
}
