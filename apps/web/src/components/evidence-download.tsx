// Bulk download of the selected evidence as one zip built in the browser (docs/specs/evidence-search.md AC-17..AC-19,
// decision 3). Each file goes through the existing GET /api/attachments/:id/download one after another, so the
// caller's permission and the stored size / SHA-256 checks apply per file. Failures are listed and the rest is saved;
// "stop", leaving the screen or a 401 saves nothing.
import { useEffect, useId, useRef, useState } from 'react';
import { fetchEvidenceFile } from '../api/evidence.ts';
import { useLocale } from '../i18n.tsx';
import { saveBlob } from '../lib/download.ts';
import {
  collectFiles,
  FAILURE_LABELS,
  formatBytes,
  selectionState,
  ZIP_MAX_BYTES,
  ZIP_MAX_FILES,
  zipEntryNames,
  zipFilename,
  type CollectResult,
  type EvidenceItem,
} from '../lib/evidence-search.ts';
import { buildZip } from '../lib/zip.ts';
import { Button } from '../ui/index.ts';

type Outcome =
  | { kind: 'saved'; saved: number; failures: CollectResult['failures'] }
  | { kind: 'none'; failures: CollectResult['failures'] }
  | { kind: 'aborted' };

export function EvidenceDownload({
  selected,
  onClear,
  refused,
}: {
  /** Selected rows in selection order. */
  selected: readonly EvidenceItem[];
  onClear: () => void;
  /** A row was not selected because the count cap was reached (AC-18). */
  refused: boolean;
}) {
  const { t, locale } = useLocale();
  const state = selectionState(selected);
  const oversizeId = useId();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const controller = useRef<AbortController | null>(null);
  // Leaving the screen (or a company switch, which remounts it) stops a running download without saving.
  useEffect(() => () => controller.current?.abort(), []);
  const running = progress !== null;

  const start = async () => {
    if (running || !state.canDownload) return;
    const items = [...selected];
    const abort = new AbortController();
    controller.current = abort;
    setOutcome(null);
    setProgress({ done: 0, total: items.length });
    try {
      const result = await collectFiles(
        items,
        (item, signal) => fetchEvidenceFile(item, signal),
        abort.signal,
        (done, total) => setProgress({ done, total }),
      );
      if (result.unauthorized) return; // the client cleared the session and went to the login screen
      if (result.aborted) {
        setOutcome({ kind: 'aborted' });
        return;
      }
      if (result.files.length === 0) {
        setOutcome({ kind: 'none', failures: result.failures });
        return;
      }
      const names = zipEntryNames(result.files.map((f) => f.item));
      const zip = await buildZip(
        result.files.map((f, i) => ({ name: names[i] as string, data: f.blob, date: new Date(f.item.createdAt) })),
      );
      if (abort.signal.aborted) {
        setOutcome({ kind: 'aborted' });
        return;
      }
      saveBlob(zip, zipFilename(new Date()));
      setOutcome({ kind: 'saved', saved: result.files.length, failures: result.failures });
    } finally {
      if (controller.current === abort) controller.current = null;
      setProgress(null);
    }
  };

  const limits = t({
    ja: `選択 ${state.count} / ${ZIP_MAX_FILES} 件・合計 ${formatBytes(state.bytes, locale)} / ${formatBytes(ZIP_MAX_BYTES, locale)}`,
    en: `Selected ${state.count} / ${ZIP_MAX_FILES} · total ${formatBytes(state.bytes, locale)} / ${formatBytes(ZIP_MAX_BYTES, locale)}`,
  });
  const failures = outcome && outcome.kind !== 'aborted' ? outcome.failures : [];
  return (
    <div className="flex flex-col gap-2" data-testid="evidence-download">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-text-secondary" data-testid="evidence-selection">
          {limits}
        </span>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void start()}
          disabled={!state.canDownload || running}
          aria-describedby={state.overSize ? oversizeId : undefined}
        >
          {t({ ja: '選択した証憑を zip でダウンロード', en: 'Download selected evidence as zip' })}
        </Button>
        {running ? (
          <Button size="sm" onClick={() => controller.current?.abort()}>
            {t({ ja: '中止', en: 'Stop' })}
          </Button>
        ) : null}
        {state.count > 0 && !running ? (
          <Button size="sm" variant="ghost" onClick={onClear}>
            {t({ ja: '選択を解除', en: 'Clear selection' })}
          </Button>
        ) : null}
      </div>
      {state.overSize ? (
        <p id={oversizeId} className="ui-field-error" data-testid="evidence-oversize">
          {t({
            ja: '選択した証憑の合計が 100 MB を超えています。選択を減らしてください。',
            en: 'The selected evidence exceeds 100 MB in total. Select fewer files.',
          })}
        </p>
      ) : null}
      {refused ? (
        <p className="ui-field-error" data-testid="evidence-selection-full">
          {t({
            ja: `一度に選べるのは ${ZIP_MAX_FILES} 件までです。`,
            en: `You can select up to ${ZIP_MAX_FILES} files at a time.`,
          })}
        </p>
      ) : null}
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
