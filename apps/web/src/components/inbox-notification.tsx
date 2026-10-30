// Inbox mail switch on /inbox (docs/specs/event-delivery.md AC-18, AC-26): "Email me when my to-dos increase". When the
// company has not enabled inbox mail or the server cannot send mail, the checkbox is disabled and the reason is tied to
// it with aria-describedby. Turning it off always works.
import { useId } from 'react';
import { useInboxNotification, useSetInboxNotification } from '../api/notifications.ts';
import { useLocale } from '../i18n.tsx';
import { notificationReason } from '../lib/event-deliveries.ts';
import { useToast } from './toast.tsx';

export function InboxNotificationToggle() {
  const { t } = useLocale();
  const toast = useToast();
  const id = useId();
  const reasonId = `${id}-reason`;
  const helpId = `${id}-help`;
  const current = useInboxNotification();
  const update = useSetInboxNotification();
  if (!current.data) return null;
  const value = current.data;
  const reason = notificationReason(value);
  // A registration that can no longer send (company switch off) may still be turned off.
  const disabled = update.isPending || (!value.available && !value.inboxEmail);
  const change = (next: boolean) =>
    update.mutate(next, {
      onSuccess: () =>
        toast.success(
          next
            ? t({ ja: '件数が増えたらメールで知らせます。', en: 'You will get an email when your to-dos increase.' })
            : t({ ja: 'メール通知を止めました。', en: 'Inbox mail is off.' }),
        ),
      onError: (error) =>
        toast.error(error, t({ ja: 'メール通知を変更できませんでした', en: 'Could not change inbox mail' })),
    });
  return (
    <div className="inbox-notification" data-testid="inbox-notification">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.inboxEmail}
          disabled={disabled}
          aria-describedby={[reason ? reasonId : '', helpId].filter(Boolean).join(' ')}
          onChange={(event) => change(event.currentTarget.checked)}
          data-testid="inbox-notification-toggle"
        />
        {t({ ja: '件数が増えたらメールで知らせる', en: 'Email me when my to-dos increase' })}
      </label>
      <p id={helpId} className="text-xs text-text-muted">
        {t({
          ja: '15 分ごとに件数を確かめ、増えたときだけ送ります。件数には画面に出ない項目が含まれることがあります。',
          en: 'Counts are checked about every 15 minutes and mailed only when they increase. The count may include items this screen does not show.',
        })}
      </p>
      {reason ? (
        <p id={reasonId} className="text-xs text-text-secondary" data-testid="inbox-notification-reason">
          {t(reason)}
        </p>
      ) : null}
    </div>
  );
}
