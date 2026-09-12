import { useLocale } from '../i18n.tsx';
import { minuteTime, timeMinute } from '../lib/shift.ts';
/** Native time controls cannot represent 24:00; an explicit day-end option preserves that boundary. */
export function ShiftTimeInput({ label, value, onChange, dayEnd = false }: { label: string; value: number; onChange: (minute: number) => void; dayEnd?: boolean }) {
  const { t } = useLocale();
  return <div className="shift-time-input"><label>{label}<input className="input" type="time" required disabled={dayEnd && value === 1440} value={value === 1440 ? '00:00' : minuteTime(value)} onChange={(event) => onChange(timeMinute(event.target.value))} /></label>{dayEnd ? <label className="shift-day-end"><input type="checkbox" checked={value === 1440} onChange={(event) => onChange(event.target.checked ? 1440 : 1080)} />{t({ ja: '24:00に終了', en: 'End at 24:00' })}</label> : null}</div>;
}
