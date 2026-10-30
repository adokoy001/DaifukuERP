// form-ergonomics AC-3: after a failed save, the summary at the top of the form — how many problems, and a link per
// message to its input (header field, or line grid row + column). Activating a link shows the input's tab (narrow
// screens) and focuses it. Items come from lib/form-errors.ts.
//
// Announcements: the list shrinks while the user fixes the inputs, so it is not a live region (an assertive, atomic
// alert would read the whole summary again on every keystroke that clears an error). Each failed attempt mounts one
// `role="alert"` sentence (keyed by the attempt) whose text stays as it was at that attempt; a second attempt with the
// same problems is announced again because the sentence is mounted again.
import { useState, type MouseEvent } from 'react';
import { useLocale } from '../i18n.tsx';
import type { SummaryItem } from '../lib/form-errors.ts';

export interface FormErrorSummaryProps {
  items: readonly SummaryItem[];
  /** The failed save attempt the summary belongs to (record-form's FormState.attempt). */
  attempt: number;
  onJump: (item: SummaryItem) => void;
}

function countText(locale: string, count: number): string {
  return locale === 'ja'
    ? `入力内容に ${count} 件の問題があります`
    : `There ${count === 1 ? 'is 1 problem' : `are ${count} problems`} with your input`;
}

/**
 * The sentence announced once per attempt. Its text is the one of that attempt (state set at mount only) and it is
 * worded as what happened, so it stays true while the list below shrinks. Messages without an input to focus (配分超過
 * and other form-level messages) are read in full here, because focus cannot carry them.
 */
function AttemptAlert({ attempt, count, notes }: { attempt: number; count: number; notes: readonly string[] }) {
  const { t } = useLocale();
  const [atAttempt] = useState(() => ({ count, notes: [...notes] }));
  return (
    <p role="alert" className="sr-only" data-testid="error-summary-alert" data-attempt={attempt}>
      {t({
        ja: `保存できませんでした。入力内容の問題が ${atAttempt.count} 件ありました。`,
        en: `Not saved: ${atAttempt.count === 1 ? '1 problem' : `${atAttempt.count} problems`} with your input. `,
      })}
      {atAttempt.notes.join(' ')}
    </p>
  );
}

export function FormErrorSummary({ items, attempt, onJump }: FormErrorSummaryProps) {
  const { t, locale } = useLocale();
  if (items.length === 0) return null;
  const text = (item: SummaryItem) => {
    const field = item.field === undefined ? '' : typeof item.field === 'string' ? item.field : t(item.field);
    if (item.line) {
      const where =
        locale === 'ja'
          ? `${t(item.line.label)} ${item.line.row} 行目の${field}`
          : `${t(item.line.label)} row ${item.line.row}, ${field}`;
      return `${where}: ${item.message}`;
    }
    return field ? `${field}: ${item.message}` : item.message;
  };
  const jump = (event: MouseEvent<HTMLAnchorElement>, item: SummaryItem) => {
    event.preventDefault();
    onJump(item);
  };
  return (
    <div
      data-testid="error-summary"
      className="ui-notice ui-notice-danger form-error-summary flex flex-col gap-1 text-xs"
    >
      <AttemptAlert
        key={attempt}
        attempt={attempt}
        count={items.length}
        notes={items.filter((item) => !item.targetId).map(text)}
      />
      <h2 className="text-sm font-semibold">{countText(locale, items.length)}</h2>
      <ul className="flex list-disc flex-col gap-0.5 pl-5">
        {items.map((item) => (
          <li key={item.key}>
            {item.targetId ? (
              <a
                href={`#${item.targetId}`}
                className="font-medium underline underline-offset-2"
                onClick={(event) => jump(event, item)}
              >
                {text(item)}
              </a>
            ) : (
              <span>{text(item)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
