// Role-based home card frame (docs/specs/role-home.md AC-7, AC-15..AC-17): title, scope note, the busy skeleton, the
// per-card failure with its own retry, the permission notice, and the "open" link. Cards never show a failure as 0.
import { Link } from '@tanstack/react-router';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useCompanyCurrency, useCurrencyScale } from '../api/company.tsx';
import type { Label } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { describeError } from '../lib/error-view.ts';
import { formatDecimal } from '../lib/format.ts';
import { hasScreen, homeReadFailure, type HomeReadFailure, type HomeSource } from '../lib/role-home.ts';
import type { NavigationCatalog } from '../lib/navigation.ts';
import { S } from '../strings.ts';
import { Button, Card, SkeletonCard } from '../ui/index.ts';
import { ErrorDetails } from './error-details.tsx';
import { Icon } from './icon.tsx';
import '../role-home.css';

export interface HomeCardEnv {
  /** AC-15: false while a view picked in the switcher has not settled yet; no read starts then. */
  enabled: boolean;
  catalog: NavigationCatalog;
  /** AC-8: "担当店舗" / "担当拠点" for the store view's cards. */
  scopeNote?: Label | undefined;
  /** AC-16: the home's polite live region. */
  announce: (text: string) => void;
  /** AC-17: a 403 re-reads /meta once per home mount. */
  onDenied: () => void;
}

const HomeCardContext = createContext<HomeCardEnv>({
  enabled: false,
  catalog: { entries: [], workspaces: [] },
  announce: () => undefined,
  onDenied: () => undefined,
});
export const HomeCardProvider = HomeCardContext.Provider;
export function useHomeCardEnv(): HomeCardEnv {
  return useContext(HomeCardContext);
}

/** The subset of a TanStack query result a card looks at. */
export interface CardRead {
  status: 'pending' | 'error' | 'success';
  error: unknown;
  isFetching: boolean;
  refetch: () => Promise<{ status: 'pending' | 'error' | 'success' }>;
}

export type CardState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | {
      kind: 'failure';
      failure: HomeReadFailure;
      error: unknown;
      retrying: boolean;
      /** Resolves to whether the card loaded; undefined when a retry was already running. */
      retry: () => Promise<boolean | undefined>;
    };

/** A card's state from its reads: any failure first (retry re-reads the failed ones), then loading, then ready. */
export function cardStateOf(source: HomeSource, reads: readonly CardRead[], enabled: boolean): CardState {
  const failed = reads.filter((read) => read.status === 'error');
  const first = failed[0];
  if (first) {
    const retrying = failed.some((read) => read.isFetching);
    return {
      kind: 'failure',
      failure: homeReadFailure(first.error, source),
      error: first.error,
      retrying,
      retry: async () => {
        if (retrying) return undefined;
        const results = await Promise.all(failed.map((read) => read.refetch()));
        return results.every((result) => result.status === 'success');
      },
    };
  }
  if (!enabled || reads.some((read) => read.status === 'pending')) return { kind: 'loading' };
  return { kind: 'ready' };
}

export interface HomeCardLink {
  href: string;
  label: Label;
}

const TOO_LARGE: Label = {
  ja: '件数が多いため帳票で確認してください。',
  en: 'There are too many records to total here. Open the report instead.',
};

/** AC-9: a cut-off or refused report is not shown as a total; the report link carries the user on. */
export function TooLargeNotice() {
  const { t } = useLocale();
  return (
    <p className="role-home-notice" data-testid="home-card-too-large">
      {t(TOO_LARGE)}
    </p>
  );
}

/** Money as the API returned it (a decimal string), in the company currency's digits (AC-9). */
export function Amount({ value, testId }: { value: string; testId?: string }) {
  const { locale } = useLocale();
  const scale = useCurrencyScale();
  const currency = useCompanyCurrency();
  const unit = currency === 'JPY' && locale === 'ja' ? '円' : (currency ?? '');
  return (
    <span className="role-home-amount" data-testid={testId} data-value={value}>
      {formatDecimal(value, scale)}
      {unit ? <small>{unit}</small> : null}
    </span>
  );
}

function Failure({ state }: { state: Extract<CardState, { kind: 'failure' }> }) {
  const { t } = useLocale();
  const view = describeError(state.error);
  return (
    <div className="ui-notice ui-notice-danger role-home-failure" data-testid="home-card-failure">
      <p className="role-home-failure-title">{t({ ja: '取得できませんでした', en: 'Could not be loaded' })}</p>
      {view.explanation ? <p className="ui-error-message">{t(view.explanation)}</p> : null}
      {view.message ? <p className="ui-error-message">{view.message}</p> : null}
      <ErrorDetails view={view} />
    </div>
  );
}

/**
 * One card. `children` renders the loaded body only (it may read query data freely); `special` replaces the failure
 * view for failures that are explanations (no fiscal period). Failures are not alerts: several cards may fail at once.
 */
export function HomeCard({
  source,
  title,
  state,
  link,
  special,
  children,
}: {
  source: HomeSource;
  title: Label;
  state: CardState;
  link?: HomeCardLink | undefined;
  special?: Partial<Record<HomeReadFailure, ReactNode>>;
  children: () => ReactNode;
}) {
  const { t } = useLocale();
  const env = useHomeCardEnv();
  const headingId = `home-card-${source}`;
  const name = t(title);
  const denied = state.kind === 'failure' && state.failure === 'denied';
  const reported = useRef(false);
  useEffect(() => {
    if (!denied || reported.current) return;
    reported.current = true;
    env.onDenied();
  }, [denied, env]);
  const retry = (current: Extract<CardState, { kind: 'failure' }>) => {
    env.announce('');
    void current.retry().then((ok) => {
      if (ok === undefined) return;
      env.announce(
        ok
          ? t({ ja: `${name}: 取得しました`, en: `${name}: loaded` })
          : t({ ja: `${name}: 再試行しましたが取得できませんでした`, en: `${name}: still could not be loaded` }),
      );
      if (ok) requestAnimationFrame(() => document.getElementById(headingId)?.focus());
    });
  };
  const showLink = link && hasScreen(env.catalog, link.href);
  const target = link ? new URL(link.href, 'https://home.invalid') : undefined;
  let body: ReactNode;
  if (state.kind === 'loading')
    body = (
      <>
        <p className="sr-only" aria-live="polite">
          {t(S.loading)}
        </p>
        <div aria-busy="true">
          <SkeletonCard lines={3} />
        </div>
      </>
    );
  else if (state.kind === 'ready') body = children();
  else if (special?.[state.failure]) body = special[state.failure];
  else if (state.failure === 'denied')
    body = (
      <p className="role-home-notice" data-testid="home-card-denied">
        {t({ ja: 'この情報を表示する権限がありません。', en: 'You do not have permission to view this information.' })}
      </p>
    );
  else if (state.failure === 'too_large') body = <TooLargeNotice />;
  else
    body = (
      <>
        <Failure state={state} />
        <Button
          size="sm"
          className="role-home-retry"
          onClick={() => {
            if (!state.retrying) retry(state);
          }}
          aria-disabled={state.retrying || undefined}
          aria-label={
            state.retrying
              ? t({ ja: `${name}を再試行中`, en: `Retrying ${name}` })
              : t({ ja: `${name}を再試行`, en: `Retry ${name}` })
          }
        >
          {state.retrying ? t({ ja: '再試行中…', en: 'Retrying…' }) : t(S.retry)}
        </Button>
      </>
    );
  return (
    <Card className="role-home-card" aria-labelledby={headingId} data-testid="home-card" data-source={source}>
      <div className="role-home-card-head">
        <h3 id={headingId} tabIndex={-1}>
          {name}
        </h3>
        {env.scopeNote ? (
          <span className="role-home-scope" data-testid="home-card-scope">
            {t(env.scopeNote)}
          </span>
        ) : null}
      </div>
      <div className="role-home-card-body">{body}</div>
      {showLink && target ? (
        <Link
          to={target.pathname as never}
          search={Object.fromEntries(target.searchParams) as never}
          className="role-home-card-link"
        >
          {t(link.label)}
          <Icon name="arrow" size={14} />
        </Link>
      ) : null}
    </Card>
  );
}
