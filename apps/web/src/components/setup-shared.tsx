// Shared parts of the setup wizard's steps (docs/specs/setup-wizard.md): what every step receives, the list of checks a
// step is judged by (status word + colour, detail, link), a save failure (AC-24) and how several inputs of one step
// report a single "unsaved changes" flag (AC-9).
import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppMeta, SettingMeta } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import type { ErrorView } from '../lib/error-view.ts';
import { healthLink, linkText, STATUS_TEXT, STATUS_TONE } from '../lib/health.ts';
import type { SetupCheck, SetupStatus, SetupStep } from '../lib/setup-wizard.ts';
import { Badge } from '../ui/index.ts';
import { ErrorDetails } from './error-details.tsx';

export interface SetupStepProps {
  step: SetupStep;
  status: SetupStatus;
  meta: AppMeta;
  settings: readonly SettingMeta[];
  /** The step's inputs differ from what is saved (AC-9). */
  onDirty: (dirty: boolean) => void;
  /** A write of the step is in flight: navigation waits (AC-9). */
  onBusy: (busy: boolean) => void;
  /** Re-reads GET /meta/setup-status (after every save, AC-2). */
  refresh: () => Promise<unknown>;
  /** Polite live-region message (AC-10). */
  announce: (text: string) => void;
}

export function settingOf(settings: readonly SettingMeta[], key: string): SettingMeta | undefined {
  return settings.find((setting) => setting.key === key);
}

/** The value a module uses: the company value, or the declared default when none is stored. */
export function effectiveValue(setting: SettingMeta | undefined): unknown {
  if (!setting) return undefined;
  return setting.isDefault ? setting.defaultValue : setting.value;
}

export function SetupChecks({ checks }: { checks: readonly SetupCheck[] }) {
  const { t } = useLocale();
  return (
    <ul className="flex flex-col" data-testid="setup-checks">
      {checks.map((check) => {
        const target = healthLink(check.href);
        return (
          <li
            key={check.id}
            data-testid={`setup-check-${check.id}`}
            data-status={check.status}
            className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-border-subtle py-2 last:border-b-0"
          >
            <Badge tone={STATUS_TONE[check.status]} className="min-w-16 shrink-0 text-center">
              {t(STATUS_TEXT[check.status])}
            </Badge>
            <span className="min-w-0 flex-1 basis-56">
              <span className="block text-sm font-semibold text-text">{t(check.label)}</span>
              <span className="block text-sm text-text-secondary">{t(check.detail)}</span>
            </span>
            {target ? (
              <Link
                to={target.to}
                search={target.search as never}
                className="ui-link"
                aria-label={t({
                  ja: `${linkText(check.status).ja}（${check.label.ja}）`,
                  en: `${linkText(check.status).en} (${check.label.en})`,
                })}
              >
                {t(linkText(check.status))}
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** AC-24: a failed save inside the step — what happened, the server's message, technical details folded. */
export function SetupSaveError({ view, testId = 'setup-save-error' }: { view: ErrorView; testId?: string }) {
  const { t } = useLocale();
  return (
    <div role="alert" className="ui-notice ui-notice-danger flex flex-col gap-1 text-sm" data-testid={testId}>
      <p className="font-semibold">{t({ ja: '保存できませんでした。', en: 'Could not save.' })}</p>
      {view.explanation ? <p>{t(view.explanation)}</p> : null}
      <p>{view.message}</p>
      <ErrorDetails view={view} />
    </div>
  );
}

/**
 * Several inputs of one step (setting cards, editors) each report dirty/clean under their own key; the step reports
 * one flag. Each key's callback is stable, so a card's effect does not re-run on every render.
 */
export function useDirtyKeys(onDirty: (dirty: boolean) => void): (key: string) => (dirty: boolean) => void {
  const [dirtyKeys, setDirtyKeys] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => onDirty(dirtyKeys.size > 0), [dirtyKeys, onDirty]);
  const cache = useRef(new Map<string, (dirty: boolean) => void>());
  const reporter = useCallback((key: string) => {
    const known = cache.current.get(key);
    if (known) return known;
    const report = (dirty: boolean) =>
      setDirtyKeys((prev) => {
        if (prev.has(key) === dirty) return prev;
        const next = new Set(prev);
        if (dirty) next.add(key);
        else next.delete(key);
        return next;
      });
    cache.current.set(key, report);
    return report;
  }, []);
  return useMemo(() => reporter, [reporter]);
}
