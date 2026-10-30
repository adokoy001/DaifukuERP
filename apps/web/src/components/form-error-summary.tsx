// form-ergonomics AC-3: after a failed save, the one `role="alert"` of the form — how many problems, and a link per
// message to its input (header field, or line grid row + column). Activating a link shows the input's tab (narrow
// screens) and focuses it. Items come from lib/form-errors.ts.
import type { MouseEvent } from 'react';
import { useLocale } from '../i18n.tsx';
import type { SummaryItem } from '../lib/form-errors.ts';

export interface FormErrorSummaryProps {
  items: readonly SummaryItem[];
  onJump: (item: SummaryItem) => void;
}

export function FormErrorSummary({ items, onJump }: FormErrorSummaryProps) {
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
      role="alert"
      data-testid="error-summary"
      className="ui-notice ui-notice-danger form-error-summary flex flex-col gap-1 text-xs"
    >
      <h2 className="text-sm font-semibold">
        {locale === 'ja'
          ? `入力内容に ${items.length} 件の問題があります`
          : `There ${items.length === 1 ? 'is 1 problem' : `are ${items.length} problems`} with your input`}
      </h2>
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
