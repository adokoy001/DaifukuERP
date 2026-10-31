// Bulk download of the selected evidence as one zip built in the browser (docs/specs/evidence-search.md AC-17..AC-19,
// decision 3). Each file goes through the existing GET /api/attachments/:id/download one after another, so the
// caller's permission and the stored size / SHA-256 checks apply per file. Failures are listed and the rest is saved;
// "stop", leaving the screen or a 401 saves nothing; a failure while building or saving the zip is reported, never lost.
// Buttons that disappear or turn disabled hand focus on (docs/conventions/ui.md): download -> Stop -> download again,
// and "Clear selection" -> the results heading (the page's `onFocusResults`).
import { useEffect, useId, useRef, useState } from 'react';
import { fetchEvidenceFile } from '../api/evidence.ts';
import { useLocale } from '../i18n.tsx';
import { saveBlob } from '../lib/download.ts';
import { describeError } from '../lib/error-view.ts';
import {
  FAILURE_LABELS,
  formatBytes,
  runEvidenceZip,
  selectionState,
  ZIP_MAX_BYTES,
  ZIP_MAX_FILES,
  type EvidenceItem,
  type ZipOutcome,
} from '../lib/evidence-search.ts';
import { buildZip } from '../lib/zip.ts';
import { Button } from '../ui/index.ts';

type FocusTarget = 'stop' | 'download' | null;

export function EvidenceDownload({
  selected,
  onClear,
  refused,
  onFocusResults,
}: {
  /** Selected rows in selection order. */
  selected: readonly EvidenceItem[];
  onClear: () => void;
  /** A row was not selected because the count cap was reached (AC-18). */
  refused: boolean;
  /** Moves focus to the results heading (where focus goes when the pressed button is gone or disabled). */
  onFocusResults: () => void;
}) {
  const { t, locale } = useLocale();
  const state = selectionState(selected);
  const oversizeId = useId();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<ZipOutcome | null>(null);
  const controller = useRef<AbortController | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const focusNext = useRef<FocusTarget>(null);
  // Leaving the screen (or a company switch, which remounts it) stops a running download without saving.
  useEffect(() => () => controller.current?.abort(), []);
  const running = progress !== null;
  const button = (name: string) => root.current?.querySelector<HTMLButtonElement>(`[data-evidence-button="${name}"]`);
  useEffect(() => {
    const target = focusNext.current;
    if (target === null) return;
    focusNext.current = null;
    const element = button(target);
    if (element && !element.disabled) element.focus();
    else onFocusResults();
  }, [running, onFocusResults]);

  const start = async () => {
    if (running || !state.canDownload) return;
    const items = [...selected];
    const abort = new AbortController();
    controller.current = abort;
    // The download button turns disabled while running: focus moves to "Stop".
    if (document.activeElement === button('download')) focusNext.current = 'stop';
    setOutcome(null);
    setProgress({ done: 0, total: items.length });
    const result = await runEvidenceZip(
      items,
      {
        fetchOne: (item, signal) => fetchEvidenceFile(item, signal),
        build: (entries) => buildZip(entries),
        save: saveBlob,
        now: () => new Date(),
      },
      abort.signal,
      (done, total) => setProgress({ done, total }),
    );
    if (controller.current === abort) controller.current = null;
    // "Stop" (pressed, or holding focus when the run ends) goes away: focus returns to the download button.
    if (document.activeElement === button('stop')) focusNext.current = 'download';
    setProgress(null);
    if (result.kind !== 'unauthorized') setOutcome(result); // a 401 already went to the login screen
  };

  const clear = () => {
    onFocusResults(); // this button and the (now disabled) download button go away with the selection
    onClear();
  };

  const limits = t({
    ja: `選択 ${state.count} / ${ZIP_MAX_FILES} 件・合計 ${formatBytes(state.bytes, locale)} / ${formatBytes(ZIP_MAX_BYTES, locale)}`,
    en: `Selected ${state.count} / ${ZIP_MAX_FILES} · total ${formatBytes(state.bytes, locale)} / ${formatBytes(ZIP_MAX_BYTES, locale)}`,
  });
  const failures = outcome && 'failures' in outcome ? outcome.failures : [];
  const failedView = outcome?.kind === 'failed' ? describeError(outcome.error) : undefined;
  return (
    <div className="flex flex-col gap-2" data-testid="evidence-download" ref={root}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-text-secondary" data-testid="evidence-selection">
          {limits}
        </span>
        <Button
          variant="primary"
          size="sm"
          data-evidence-button="download"
          onClick={() => void start()}
          disabled={!state.canDownload || running}
          aria-describedby={state.overSize ? oversizeId : undefined}
        >
          {t({ ja: '選択した証憑を zip でダウンロード', en: 'Download selected evidence as zip' })}
        </Button>
        {running ? (
          <Button size="sm" data-evidence-button="stop" onClick={() => controller.current?.abort()}>
            {t({ ja: '中止', en: 'Stop' })}
          </Button>
        ) : null}
        {state.count > 0 && !running ? (
          <Button size="sm" variant="ghost" onClick={clear}>
            {t({ ja: '選択を解除', en: 'Clear selection' })}
          </Button>
        ) : null}
      </div>
      {/* AC-18: the limits are announced when they start to apply (the refused checkbox itself just stays clear). */}
      <div role="status" className="flex flex-col gap-0.5" data-testid="evidence-selection-status">
        {state.overSize ? (
          <p id={oversizeId} className="ui-field-error" data-testid="evidence-oversize">
            {t({
              ja: '選択した証憑の合計が 100 MB を超えています。選択を減らしてください。',
              en: 'The selected evidence exceeds 100 MB in total. Select fewer files.',
            })}
          </p>
        ) : null}
        {refused || state.full ? (
          <p className={refused ? 'ui-field-error' : 'text-xs text-text-muted'} data-testid="evidence-selection-full">
            {t({
              ja: `一度に選べるのは ${ZIP_MAX_FILES} 件までです。`,
              en: `You can select up to ${ZIP_MAX_FILES} files at a time.`,
            })}
          </p>
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite" data-testid="evidence-progress">
        {progress
          ? t({
              ja: `${progress.done} / ${progress.total} 件を取得しました`,
              en: `Fetched ${progress.done} of ${progress.total}`,
            })
          : ''}
      </p>
      {running ? (
        <p className="text-xs text-text-secondary" aria-hidden="true">
          {t({
            ja: `取得中… ${progress.done} / ${progress.total} 件`,
            en: `Fetching… ${progress.done} / ${progress.total}`,
          })}
        </p>
      ) : null}
      <div aria-live="polite" data-testid="evidence-download-result">
        {outcome?.kind === 'saved' ? (
          <p className={`ui-notice ${failures.length ? 'ui-notice-warning' : 'ui-notice-success'} text-sm`}>
            {t({
              ja: `${outcome.saved} 件を zip に保存しました。`,
              en: `Saved ${outcome.saved} file(s) in the zip.`,
            })}
            {failures.length
              ? t({
                  ja: ` ${failures.length} 件は取得できませんでした。`,
                  en: ` ${failures.length} could not be fetched.`,
                })
              : ''}
          </p>
        ) : null}
        {outcome?.kind === 'none' ? (
          <p className="ui-notice ui-notice-danger text-sm">
            {t({
              ja: 'どの証憑も取得できなかったため、zip は保存していません。',
              en: 'No evidence could be fetched, so no zip was saved.',
            })}
          </p>
        ) : null}
        {outcome?.kind === 'failed' ? (
          <div
            className="ui-notice ui-notice-danger flex flex-col gap-0.5 text-sm"
            data-testid="evidence-download-failed"
          >
            <p>
              {t({
                ja: 'zip を作成または保存できなかったため、何も保存していません。選択を減らしてもう一度試してください。',
                en: 'The zip could not be built or saved, so nothing was saved. Select fewer files and try again.',
              })}
            </p>
            {failedView?.message ? <p className="text-xs">{failedView.message}</p> : null}
          </div>
        ) : null}
        {outcome?.kind === 'aborted' ? (
          <p className="ui-notice text-sm">
            {t({ ja: '中止しました。何も保存していません。', en: 'Stopped. Nothing was saved.' })}
          </p>
        ) : null}
      </div>
      {failures.length ? (
        <ul className="flex flex-col gap-0.5 text-xs" data-testid="evidence-download-failures">
          {failures.map((f) => (
            <li key={f.item.id}>
              <span className="font-semibold">{f.item.filename}</span>: {t(FAILURE_LABELS[f.reason])}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
