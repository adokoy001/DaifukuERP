import type { ShiftSlot } from '@daifuku/mod-workforce/scheduling';
import { ShiftTimeInput } from './shift-time-input.tsx';
import { useLocale } from '../i18n.tsx';
import { newSlot, shiftWeek } from '../lib/shift.ts';
export function ShiftSlots({ weekStart, slots, disabled, onChange, onRemove }: { weekStart: string; slots: ShiftSlot[]; disabled: boolean; onChange: (slots: ShiftSlot[]) => void; onRemove: (id: string) => void }) {
  const { t } = useLocale();
  const patch = (id: string, values: Partial<ShiftSlot>) => onChange(slots.map((slot) => slot.id === id ? { ...slot, ...values } : slot));
  return <section className="workforce-panel shift-slots"><header className="workforce-panel-heading"><div><h2>{t({ ja: '1. 勤務枠と必要人数', en: '1. Shift slots and demand' })}</h2><p>{t({ ja: '休憩は時間数を指定します。1週間42枠・1枠20人まで。日内勤務のみ。', en: 'Specify break minutes. Up to 42 slots per week and 20 people per slot. Same-day shifts only.' })}</p></div></header>
    {shiftWeek(weekStart).map((date) => <section className="shift-day" key={date}><header><h3>{date}</h3><button type="button" className="btn" disabled={disabled || slots.length >= 42} onClick={() => onChange([...slots, newSlot(date)])}>{t({ ja: '勤務枠を追加', en: 'Add shift slot' })}</button></header>
      {slots.filter((slot) => slot.date === date).map((slot, index) => <fieldset disabled={disabled} className="shift-slot-fields" key={slot.id}><legend>{t({ ja: '勤務枠', en: 'Shift slot' })} {index + 1}</legend>
        <label>{t({ ja: '枠の名前', en: 'Slot name' })}<input className="input" value={slot.label} maxLength={80} onChange={(event) => patch(slot.id, { label: event.target.value })} /></label>
        <ShiftTimeInput label={t({ ja: '開始', en: 'Start' })} value={slot.startMinute} onChange={(startMinute) => patch(slot.id, { startMinute })} />
        <ShiftTimeInput label={t({ ja: '終了', en: 'End' })} dayEnd value={slot.endMinute} onChange={(endMinute) => patch(slot.id, { endMinute })} />
        <label>{t({ ja: '休憩（分）', en: 'Break (minutes)' })}<input className="input" type="number" min={0} max={480} step={1} value={slot.breakMinutes} onChange={(event) => patch(slot.id, { breakMinutes: Number(event.target.value) })} /></label>
        <label>{t({ ja: '必要人数', en: 'Required people' })}<input className="input" type="number" min={1} max={20} step={1} value={slot.required} onChange={(event) => patch(slot.id, { required: Number(event.target.value) })} /></label>
        <label>{t({ ja: '必要スキル（任意）', en: 'Required skill (optional)' })}<input className="input" value={slot.skill} maxLength={40} onChange={(event) => patch(slot.id, { skill: event.target.value })} /></label>
        <button type="button" className="btn" onClick={() => onRemove(slot.id)}>{t({ ja: '枠を削除', en: 'Remove slot' })}</button>
      </fieldset>)}{!slots.some((slot) => slot.date === date) ? <p className="shift-muted">{t({ ja: '勤務枠なし', en: 'No slots planned' })}</p> : null}
    </section>)}
  </section>;
}
