import '../finance.css';
import '../commerce.css';
import '../workforce.css';
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import type { Label } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { Icon } from './icon.tsx';
import { ReadRecoveryProvider, ReadRefreshNotice, type ReadSource } from './read-refresh-notice.tsx';
import { canRetainData } from '../lib/read-recovery.ts';
import { WorkforceError } from './workforce-shared.tsx';
import { RefField } from './fields/ref-field.tsx';
export {
  CommercePanel as FinancePanel,
  CommerceEmpty as FinanceEmpty,
  CommerceMoney as FinanceMoney,
  SourceLink,
  CommerceDialog as FinanceDialog,
} from './commerce-shared.tsx';

export function FinanceShell({
  title,
  subtitle,
  eyebrow,
  allowed,
  ready,
  sources,
  children,
}: {
  title: Label;
  subtitle: Label;
  eyebrow: string;
  allowed: boolean;
  ready: boolean;
  sources: ReadSource[];
  children: ReactNode;
}) {
  const { t } = useLocale();
  const failed = sources.find((source) => source.isError && !canRetainData(source));
  return (
    <div className="workspace-page finance-page">
      <header className="finance-hero">
        <div>
          <span className="eyebrow">DAIFUKU · {eyebrow}</span>
          <h1>{t(title)}</h1>
          <p>{t(subtitle)}</p>
        </div>
        <div className="finance-orbit" aria-hidden="true">
          <Icon name="chart" size={40} />
        </div>
      </header>
      {failed ? (
        <WorkforceError
          error={failed.error}
          onRetry={() => {
            for (const source of sources) void source.refetch();
          }}
        />
      ) : !ready ? (
        <p role="status">{t({ ja: '利用権限を確認しています…', en: 'Checking access…' })}</p>
      ) : !allowed ? (
        <p className="commerce-notice">
          {t({
            ja: 'この会社でこの機能を利用する権限がありません。',
            en: 'You do not have access to this feature in this company.',
          })}
        </p>
      ) : (
        <ReadRecoveryProvider sources={sources}>
          <ReadRefreshNotice />
          {children}
        </ReadRecoveryProvider>
      )}
    </div>
  );
}

export function FinanceField({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: Label }) {
  const { t } = useLocale();
  const id = useId();
  return (
    <label className="finance-field" htmlFor={id}>
      <span>{t(label)}</span>
      <input {...props} id={id} className="input" />
    </label>
  );
}

export function FinanceRef({
  label,
  name,
  entity,
  value,
  onChange,
  required = true,
}: {
  label: Label;
  name: string;
  entity: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const { t } = useLocale();
  const id = useId();
  return (
    <div className="finance-field">
      <label htmlFor={id}>{t(label)}</label>
      <RefField
        id={id}
        disabled={false}
        invalid={false}
        field={{
          name: `${name}Search`,
          kind: 'ref',
          label,
          ref: entity,
          hidden: false,
          immutable: false,
          hasDefault: false,
          required,
        }}
        value={value}
        onChange={(next) => onChange(typeof next === 'string' ? next : '')}
      />
      <input type="hidden" name={name} value={value} />
    </div>
  );
}

export function FinanceSteps({ steps }: { steps: Label[] }) {
  const { t } = useLocale();
  return (
    <ol className="finance-steps">
      {steps.map((step, index) => (
        <li key={step.en}>
          <span>{index + 1}</span>
          <strong>{t(step)}</strong>
        </li>
      ))}
    </ol>
  );
}

export function FinanceNotice({ children }: { children: ReactNode }) {
  return <p className="finance-notice">{children}</p>;
}
