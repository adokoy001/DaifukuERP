// Accounting home view (docs/specs/role-home.md AC-9): receivables, payables, cash and the month-end close, each from
// the existing report action the caller can already run. Amounts stay decimal strings (lib/decimal.ts); a cut-off
// or refused report is never shown as a total.
import type { ReactNode } from 'react';
import { callHomeAction, listHomeEntity, useHomeRead } from '../api/role-home.ts';
import type { ListResponse, TableResult } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import type { CloseReadiness } from '../lib/close-guide.ts';
import {
  agingSummary,
  CASH_ACCOUNT_LIMIT,
  CASH_SUBTYPE,
  cashSummary,
  closeSummary,
  decimalSign,
  HOME_ACTIONS,
  type HomeSource,
} from '../lib/role-home.ts';
import { Badge } from '../ui/index.ts';
import {
  Amount,
  cardStateOf,
  HOME_NOTICES,
  HomeCard,
  TooLargeNotice,
  Unreadable,
  useHomeCardEnv,
} from './role-home-card.tsx';

function Figure({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="role-home-figure" data-testid={testId}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function AgingCard({ kind }: { kind: 'ar' | 'ap' }) {
  const { t } = useLocale();
  const { enabled } = useHomeCardEnv();
  const action = kind === 'ar' ? HOME_ACTIONS.arAging : HOME_ACTIONS.apAging;
  const source: HomeSource = kind === 'ar' ? 'ar_aging' : 'ap_aging';
  const read = useHomeRead<TableResult>([action], (signal) => callHomeAction(action, {}, signal), enabled);
  return (
    <HomeCard
      source={source}
      title={kind === 'ar' ? { ja: '売掛金', en: 'Receivables' } : { ja: '買掛金', en: 'Payables' }}
      state={cardStateOf(source, [read], enabled)}
      link={{ href: `/r/${action}`, label: { ja: '年齢表を開く', en: 'Open the aging report' } }}
    >
      {() => {
        const summary = agingSummary(kind, read.data);
        if (summary.kind === 'truncated') return <TooLargeNotice />;
        if (summary.kind !== 'ok') return <Unreadable />;
        const { balance, overdue, over90, asOf } = summary.value;
        return (
          <>
            <dl className="role-home-figures">
              <Figure
                label={
                  kind === 'ar' ? t({ ja: '未入金残高', en: 'Open balance' }) : t({ ja: '未払残高', en: 'Unpaid' })
                }
                testId="home-aging-balance"
              >
                <Amount value={balance} />
              </Figure>
              <Figure label={t({ ja: '期日超過', en: 'Overdue' })} testId="home-aging-overdue">
                <Amount value={overdue} />
                {decimalSign(overdue) === 1 ? (
                  <Badge tone="warning" className="role-home-flag">
                    {t({ ja: '期日超過あり', en: 'Has overdue items' })}
                  </Badge>
                ) : null}
              </Figure>
              <Figure label={t({ ja: 'うち90日超', en: 'Over 90 days' })} testId="home-aging-over90">
                <Amount value={over90} />
              </Figure>
            </dl>
            {asOf ? <p className="role-home-caption">{t({ ja: `${asOf} 時点`, en: `As of ${asOf}` })}</p> : null}
          </>
        );
      }}
    </HomeCard>
  );
}

function CashCard() {
  const { t } = useLocale();
  const { enabled } = useHomeCardEnv();
  const params = new URLSearchParams({
    where: JSON.stringify({ subtype: CASH_SUBTYPE }),
    orderBy: 'code:asc',
    limit: String(CASH_ACCOUNT_LIMIT),
  });
  const accounts = useHomeRead<ListResponse>(
    ['account', params.toString()],
    (signal) => listHomeEntity('account', params, signal),
    enabled,
  );
  const balance = useHomeRead<TableResult>(
    [HOME_ACTIONS.trialBalance],
    (signal) => callHomeAction(HOME_ACTIONS.trialBalance, {}, signal),
    enabled,
  );
  return (
    <HomeCard
      source="cash"
      title={{ ja: '現金預金', en: 'Cash and deposits' }}
      state={cardStateOf('cash', [accounts, balance], enabled)}
      link={{ href: `/r/${HOME_ACTIONS.trialBalance}`, label: { ja: '試算表を開く', en: 'Open the trial balance' } }}
    >
      {() => {
        const summary = cashSummary(accounts.data, balance.data);
        if (summary.kind === 'none')
          return (
            <p className="role-home-notice" data-testid="home-cash-none">
              {t({ ja: '現金預金の科目が見つかりません。', en: 'No cash and deposit accounts were found.' })}
            </p>
          );
        if (summary.kind === 'truncated') return <TooLargeNotice />;
        if (summary.kind !== 'ok') return <Unreadable />;
        const { accounts: count, asOf } = summary.value;
        return (
          <>
            <dl className="role-home-figures">
              <Figure label={t({ ja: '帳簿残高', en: 'Book balance' })} testId="home-cash-balance">
                <Amount value={summary.value.balance} />
              </Figure>
              <Figure label={t({ ja: '対象の科目', en: 'Accounts' })} testId="home-cash-accounts">
                {t({ ja: `${count}科目`, en: `${count}` })}
              </Figure>
            </dl>
            {asOf ? (
              <p className="role-home-caption">
                {t({ ja: `試算表の ${asOf} 時点の残高`, en: `Trial balance as of ${asOf}` })}
              </p>
            ) : null}
          </>
        );
      }}
    </HomeCard>
  );
}

const CLOSE_STATUS = {
  closed: { ja: '締め済み', en: 'Closed' },
  ready: { ja: '締められます', en: 'Ready to close' },
} as const;

function CloseCard() {
  const { t, locale } = useLocale();
  const { enabled } = useHomeCardEnv();
  const read = useHomeRead<CloseReadiness>(
    [HOME_ACTIONS.closeReadiness],
    (signal) => callHomeAction(HOME_ACTIONS.closeReadiness, {}, signal),
    enabled,
  );
  const summary = closeSummary(read.data);
  return (
    <HomeCard
      source="close"
      title={{ ja: '月次締め', en: 'Month-end close' }}
      state={cardStateOf('close', [read], enabled)}
      link={{
        href: summary ? `/finance/close?periodId=${summary.periodId}` : '/finance/close',
        label: { ja: '締めガイドを開く', en: 'Open the close guide' },
      }}
      special={{
        no_fiscal_period: (
          <p className="role-home-notice" data-testid="home-close-no-year">
            {t(HOME_NOTICES.no_fiscal_period)}
          </p>
        ),
      }}
    >
      {() => {
        if (!summary) return <Unreadable />;
        const range =
          locale === 'ja' ? `${summary.startDate}〜${summary.endDate}` : `${summary.startDate} to ${summary.endDate}`;
        return (
          <>
            <p className="role-home-period" data-testid="home-close-period">
              <strong>{summary.code}</strong> <span>{range}</span>
            </p>
            <p data-testid="home-close-status">
              {summary.status === 'blocked' ? (
                <Badge tone="warning">
                  {t({
                    ja: `締めを止める項目 ${summary.blocking}件`,
                    en: `${summary.blocking} item(s) block the close`,
                  })}
                </Badge>
              ) : (
                <Badge tone={summary.status === 'ready' ? 'success' : 'neutral'}>
                  {t(CLOSE_STATUS[summary.status])}
                </Badge>
              )}
            </p>
          </>
        );
      }}
    </HomeCard>
  );
}

export function AccountingCards({ cards }: { cards: readonly HomeSource[] }) {
  return (
    <div className="role-home-grid">
      {cards.map((source) => {
        if (source === 'ar_aging') return <AgingCard key={source} kind="ar" />;
        if (source === 'ap_aging') return <AgingCard key={source} kind="ap" />;
        if (source === 'cash') return <CashCard key={source} />;
        if (source === 'close') return <CloseCard key={source} />;
        return null;
      })}
    </div>
  );
}
