import { useEffect, useRef } from 'react';
import { useLocale } from '../i18n.tsx';
import { S } from '../strings.ts';
import { Icon } from './icon.tsx';

interface Props {
  title: string;
  message: string;
  cancelDocument: boolean;
  destructive: boolean;
  onConfirm: (correctionDate?: string) => void;
  onClose: () => void;
}

/** Native modal supplies focus trapping, Escape handling and focus restoration. */
export function ActionConfirm({ title, message, cancelDocument, destructive, onConfirm, onClose }: Props) {
  const { t } = useLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog ref={dialog} className="action-dialog" onCancel={onClose} onClose={onClose} aria-labelledby="action-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const date = new FormData(e.currentTarget).get('correctionDate');
          onConfirm(typeof date === 'string' && date ? date : undefined);
        }}
      >
        <div className="dialog-heading">
          <span className="icon-tile">
            <Icon name={cancelDocument ? 'clock' : 'document'} />
          </span>
          <button type="button" onClick={onClose} aria-label={t(S.close)}>
            <Icon name="close" />
          </button>
        </div>
        <h2 id="action-title">{title}</h2>
        <p>{message}</p>
        {cancelDocument ? (
          <div className="correction-field">
            <label htmlFor="correction-date">{t({ ja: '訂正日（任意）', en: 'Correction date (optional)' })}</label>
            <input
              id="correction-date"
              name="correctionDate"
              type="date"
              className="input"
              aria-describedby="correction-hint"
            />
            <p id="correction-hint">
              {t({
                ja: '空欄なら元の取引日で取消します。元の会計期間が締まっている場合は、現在の開いている期間の訂正日を指定してください。',
                en: 'Leave blank to reverse on the original transaction date. If that period is closed, choose a correction date in an open period.',
              })}
            </p>
          </div>
        ) : null}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose} autoFocus>
            {t({ ja: '戻る', en: 'Go back' })}
          </button>
          <button type="submit" className={`btn ${destructive ? 'btn-danger' : 'btn-primary'}`}>
            {title}
          </button>
        </div>
      </form>
    </dialog>
  );
}
