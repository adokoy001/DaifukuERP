import { Link } from '@tanstack/react-router';
import type { MenuItem } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { Icon } from './icon.tsx';

export function WorkflowLink({ item }: { item: MenuItem }) {
  const { t } = useLocale();
  const content = (
    <>
      {t(item.label)}
      <Icon name="arrow" size={15} />
    </>
  );
  if (item.entity)
    return (
      <Link className="template-workflow" to="/e/$entity" params={{ entity: item.entity }}>
        {content}
      </Link>
    );
  const match = /^\/(r|a)\/([^/?#]+)$/.exec(item.route ?? '');
  if (!match?.[2]) return null;
  return match[1] === 'r' ? (
    <Link className="template-workflow" to="/r/$action" params={{ action: match[2] }}>
      {content}
    </Link>
  ) : (
    <Link className="template-workflow" to="/a/$action" params={{ action: match[2] }}>
      {content}
    </Link>
  );
}
