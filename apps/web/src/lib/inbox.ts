// To-do inbox aggregation (docs/specs/inbox.md, docs/conventions/ui.md "やること受信箱"). Pure: which `<module>.todo`
// providers /meta lets the caller run, how one provider's response becomes displayable items, and how the groups are
// summarized for the home card. Hrefs are trusted only after they resolve to an entry of the authorized screen catalog.
import type { AppMeta, Label } from '../api/types.ts';
import { findNavigationEntry, isTodoProvider, type NavigationCatalog } from './navigation.ts';

export interface InboxProvider {
  /** `<module>.todo` action name; also the provider's identity. */
  action: string;
  module: string;
  label: Label;
}
export interface InboxTarget {
  pathname: string;
  search: Record<string, string>;
}
export interface InboxItem {
  /** `<action>:<key>`, stable across refreshes. */
  id: string;
  provider: string;
  key: string;
  label: Label;
  count: number;
  severity: 'info' | 'warn';
  target: InboxTarget;
}
export type ProviderOutcome =
  { action: string; ok: true; value: unknown } | { action: string; ok: false; error: unknown };
export type InboxGroupStatus = 'loading' | 'ok' | 'error';
export interface InboxGroup {
  provider: InboxProvider;
  status: InboxGroupStatus;
  items: InboxItem[];
  /** Sum of the displayed items' counts. */
  total: number;
  /** Items left out because their href is not a known in-app screen or their shape is invalid. */
  dropped: number;
  error?: unknown;
}
export interface InboxSummary {
  total: number;
  top: InboxItem[];
  failed: InboxProvider[];
  loading: boolean;
}

const KEY = /^[a-z][a-z0-9_]*$/;
const ORIGIN = 'https://inbox.invalid';

/** Runnable providers in /meta order, labelled with their module (or pack) name. */
export function inboxProviders(meta: AppMeta | undefined): InboxProvider[] {
  if (!meta) return [];
  return meta.actions.filter(isTodoProvider).map((action) => ({
    action: action.name,
    module: action.module,
    label: meta.modules.find((module) => module.name === action.module)?.label ?? action.description,
  }));
}

/** An in-app href whose path is a screen of the caller's catalog; anything else (external, unknown) is refused. */
export function inboxTarget(href: unknown, catalog: NavigationCatalog): InboxTarget | undefined {
  if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//') || /[\\\s]/.test(href))
    return undefined;
  let url: URL;
  try {
    url = new URL(href, ORIGIN);
  } catch {
    return undefined;
  }
  if (url.origin !== ORIGIN || url.hash || !findNavigationEntry(catalog, url.pathname)) return undefined;
  return { pathname: url.pathname, search: Object.fromEntries(url.searchParams) };
}

function isLabel(value: unknown): value is Label {
  const label = value as Partial<Label> | null;
  return typeof label?.ja === 'string' && typeof label.en === 'string' && label.ja !== '' && label.en !== '';
}

/** Validated items of one provider response; malformed items and unknown hrefs are counted as dropped. */
export function providerItems(
  provider: string,
  value: unknown,
  catalog: NavigationCatalog,
): { items: InboxItem[]; dropped: number } {
  const raw = (value as { items?: unknown } | null)?.items;
  if (!Array.isArray(raw)) return { items: [], dropped: 0 };
  const items: InboxItem[] = [];
  const seen = new Set<string>();
  for (const entry of raw as Record<string, unknown>[]) {
    const target = inboxTarget(entry?.href, catalog);
    const { key, count, severity, label } = entry ?? {};
    if (
      !target ||
      typeof key !== 'string' ||
      !KEY.test(key) ||
      seen.has(key) ||
      !Number.isSafeInteger(count) ||
      (count as number) <= 0 ||
      (severity !== 'info' && severity !== 'warn') ||
      !isLabel(label)
    )
      continue;
    seen.add(key);
    items.push({ id: `${provider}:${key}`, provider, key, label, count: count as number, severity, target });
  }
  return { items, dropped: raw.length - items.length };
}

/** One group per runnable provider: still loading, failed (with its error) or its validated items. */
export function inboxGroups(
  providers: readonly InboxProvider[],
  outcomes: readonly ProviderOutcome[] | undefined,
  pending: ReadonlySet<string>,
  catalog: NavigationCatalog,
): InboxGroup[] {
  return providers.map((provider) => {
    const outcome = outcomes?.find((item) => item.action === provider.action);
    if (!outcome || pending.has(provider.action))
      return { provider, status: 'loading', items: [], total: 0, dropped: 0 };
    if (!outcome.ok) return { provider, status: 'error', items: [], total: 0, dropped: 0, error: outcome.error };
    const { items, dropped } = providerItems(provider.action, outcome.value, catalog);
    return { provider, status: 'ok', items, total: items.reduce((sum, item) => sum + item.count, 0), dropped };
  });
}

/** Home card summary: total of the loaded groups, warnings first then larger counts, and the failed providers. */
export function inboxSummary(groups: readonly InboxGroup[], limit = 5): InboxSummary {
  const order = new Map(groups.map((group, index) => [group.provider.action, index]));
  const top = groups
    .flatMap((group) => group.items)
    .sort(
      (a, b) =>
        Number(b.severity === 'warn') - Number(a.severity === 'warn') ||
        b.count - a.count ||
        (order.get(a.provider) ?? 0) - (order.get(b.provider) ?? 0),
    )
    .slice(0, limit);
  return {
    total: groups.reduce((sum, group) => sum + group.total, 0),
    top,
    failed: groups.filter((group) => group.status === 'error').map((group) => group.provider),
    loading: groups.some((group) => group.status === 'loading'),
  };
}

/** Replace one provider's outcome after a retry, keeping the others as they are. */
export function replaceOutcome(
  outcomes: readonly ProviderOutcome[] | undefined,
  next: ProviderOutcome,
): ProviderOutcome[] {
  const rest = (outcomes ?? []).filter((item) => item.action !== next.action);
  return [...rest, next];
}
