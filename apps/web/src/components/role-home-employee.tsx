// Employee home view (docs/specs/role-home.md AC-11): the portal is the employee's work screen, so the home gives a
// primary link to /me and links to its tabs. Nothing is read here (no workforce.my_portal), and nothing redirects.
import { Link } from '@tanstack/react-router';
import { useLocale } from '../i18n.tsx';
import { employeeLinks } from '../lib/role-home.ts';
import { buttonClass, Card } from '../ui/index.ts';
import { Icon } from './icon.tsx';
import { useHomeCardEnv } from './role-home-card.tsx';

export function EmployeeHome() {
  const { t } = useLocale();
  const { catalog } = useHomeCardEnv();
  const links = employeeLinks(catalog);
  return (
    <Card
      className="role-home-card role-home-employee"
      aria-labelledby="home-employee-title"
      data-testid="home-employee"
    >
      <h3 id="home-employee-title">{t({ ja: '自分の勤怠・申請', en: 'My workday' })}</h3>
      <p className="role-home-caption">
        {t({
          ja: '打刻・シフト・休暇・経費は、自分の勤怠・申請の画面で行います。',
          en: 'Clock in and out, see shifts, and submit leave and expenses on your workday screen.',
        })}
      </p>
      <Link to="/me" className={buttonClass('primary', 'md', 'role-home-primary')} data-testid="home-employee-primary">
        <Icon name="clock" size={18} />
        {t({ ja: '自分の勤怠・申請を開く', en: 'Open my workday' })}
      </Link>
      {links.length ? (
        <ul className="role-home-links">
          {links.map((link) => {
            const url = new URL(link.href, 'https://home.invalid');
            return (
              <li key={link.href}>
                <Link to="/me" search={Object.fromEntries(url.searchParams) as never} className="role-home-link">
                  {t(link.label)}
                  <Icon name="arrow" size={14} />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}
