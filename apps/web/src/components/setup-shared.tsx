// Shared parts of the setup wizard's steps (docs/specs/setup-wizard.md): what every step receives, the list of checks a
// step is judged by (status word + colour, detail, link), a save or load failure (AC-24) and how several inputs of one
// step report a single "unsaved changes" or "saving" flag (AC-9).
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
  /** Moves focus to the step's heading, e.g. when the control that had it is gone after a save (AC-10). */
  focusHeading: () => void;
}

export function settingOf(settings: readonly SettingMeta[], key: string): SettingMeta | undefined {
  return settings.find((setting) => setting.key === key);
}

/** The value a module uses: the company value, or the declared default when none is stored. */
export function effectiveValue(setting: SettingMeta | undefined): unknown {
  if (!setting) return undefined;
  return setting.isDefault ? setting.defaultValue : setting.value;
}

/** `links: false` drops the fix links (e.g. a screen the viewer cannot use). */
export function SetupChecks({ checks, links = true }: { checks: readonly SetupCheck[]; links?: boolean }) {
  const { t } = useLocale();
  return (
    <ul className="flex flex-col" data-testid="setup-checks">
      {checks.map((check) => {
        const target = links ? healthLink(check.href) : undefined;
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

/**
 * AC-24: a failed save inside the step — what happened, the server's message, technical details folded. `kind: 'load'`
 * says that a read of the step's data failed instead.
 */
export function SetupSaveError({
  view,
  testId = 'setup-save-error',
  kind = 'save',
}: {
  view: ErrorView;
  testId?: string;
  kind?: 'save' | 'load';
}) {
  const { t } = useLocale();
  return (
    <div role="alert" className="ui-notice ui-notice-danger flex flex-col gap-1 text-sm" data-testid={testId}>
      <p className="font-semibold">
        {kind === 'load'
          ? t({ ja: '読み込めませんでした。', en: 'Could not load.' })
          : t({ ja: '保存できませんでした。', en: 'Could not save.' })}
      </p>
      {view.explanation ? <p>{t(view.explanation)}</p> : null}
      <p>{view.message}</p>
      <ErrorDetails view={view} />
    </div>
  );
}

/**
 * Several parts of one step (setting cards, editors, the step's own save) each report a flag (unsaved changes, a write
 * in flight) under their own key; the step reports one flag: set while any key is set. Each key's callback is stable,
 * so a card's effect does not re-run on every render. When the step unmounts (another step opens), the flag is cleared:
 * the parts' own clean-up reports reach the unmounted step only, so without this the page would keep asking to discard
 * changes that no longer exist.
 */
export function useFlagKeys(onFlag: (on: boolean) => void): (key: string) => (on: boolean) => void {
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => onFlag(keys.size > 0), [keys, onFlag]);
  useEffect(() => () => onFlag(false), [onFlag]);
  const cache = useRef(new Map<string, (on: boolean) => void>());
  const reporter = useCallback((key: string) => {
    const known = cache.current.get(key);
    if (known) return known;
    const report = (on: boolean) =>
      setKeys((prev) => {
        if (prev.has(key) === on) return prev;
        const next = new Set(prev);
        if (on) next.add(key);
        else next.delete(key);
        return next;
      });
    cache.current.set(key, report);
    return report;
  }, []);
  return useMemo(() => reporter, [reporter]);
}

/** The step's unsaved-changes flag from several inputs (AC-9). */
export const useDirtyKeys = useFlagKeys;
/** The step's "a write is in flight" flag from several parts (AC-9: nothing moves while saving). */
export const useBusyKeys = useFlagKeys;
