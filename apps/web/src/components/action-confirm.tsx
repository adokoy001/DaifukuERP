// Confirmation for document actions (submit / cancel / delete / generic actions), built on the UI kit Dialog
// (ui-kit AC-12): first focus on "Go back", the message as the dialog's description, focus back to the opener on close.
import { useLocale } from '../i18n.tsx';
import { S } from '../strings.ts';
import { Button, Dialog } from '../ui/index.ts';
import { Icon } from './icon.tsx';

interface Props {
  title: string;
  message: string;
  cancelDocument: boolean;
  destructive: boolean;
  onConfirm: (correctionDate?: string) => void;
  onClose: () => void;
}

export function ActionConfirm({ title, message, cancelDocument, destructive, onConfirm, onClose }: Props) {
  const { t } = useLocale();
  return (
    <Dialog
      title={title}
      description={message}
      closeLabel={t(S.close)}
      onClose={onClose}
      icon={
        <span className="icon-tile">
          <Icon name={cancelDocument ? 'clock' : 'document'} />
        </span>
      }
      onSubmit={(e) => {
        e.preventDefault();
        const date = new FormData(e.currentTarget).get('correctionDate');
        onConfirm(typeof date === 'string' && date ? date : undefined);
      }}
      actions={
        <>
          <Button onClick={onClose} data-autofocus>
            {t({ ja: '戻る', en: 'Go back' })}
          </Button>
          <Button type="submit" variant={destructive ? 'danger' : 'primary'}>
            {title}
          </Button>
        </>
      }
    >
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
    </Dialog>
  );
}
