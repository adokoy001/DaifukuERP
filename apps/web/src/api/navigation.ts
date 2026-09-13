import { useMemo } from 'react';
import { buildNavigation } from '../lib/navigation.ts';
import { canRetainData } from '../lib/read-recovery.ts';
import { useMe } from './company.tsx';
import { useMeta } from './queries.ts';

/** The catalog contains screen definitions only; business records stay in their existing pages. */
export function useNavigation() {
  const meta = useMeta();
  const me = useMe();
  const available = meta.isError && !canRetainData(meta) ? undefined : meta.data;
  const tenantAdmin = !me.isError && me.data?.user.tenantAdmin === true;
  const catalog = useMemo(() => buildNavigation(available, tenantAdmin), [available, tenantAdmin]);
  return { catalog, meta };
}
