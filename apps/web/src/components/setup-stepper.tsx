// The setup wizard's step list (docs/specs/setup-wizard.md AC-1, AC-10): an <ol> of buttons, the open step marked
// aria-current="step", each status in words and colour. Roving tabindex: only the focused step (at first the open
// one) is in the Tab order; arrows move between steps (wrapping), Home / End to the ends, Enter / Space open.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useLocale } from '../i18n.tsx';
import {
  OPTIONAL_TEXT,
  STEP_STATUS_TEXT,
  STEP_STATUS_TONE,
  stepperKeyTarget,
  type SetupStep,
  type SetupStepId,
} from '../lib/setup-wizard.ts';
import { Badge, cx } from '../ui/index.ts';

export function SetupStepper({
  steps,
  current,
  onOpen,
}: {
  steps: readonly SetupStep[];
  current: SetupStepId;
  onOpen: (id: SetupStepId) => void;
}) {
  const { t } = useLocale();
  const currentIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === current),
  );
  const [focusIndex, setFocusIndex] = useState(currentIndex);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => setFocusIndex(currentIndex), [currentIndex]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = stepperKeyTarget(event.key, index, steps.length);
    if (target === undefined) return;
    event.preventDefault();
    setFocusIndex(target);
    buttons.current[target]?.focus();
  };
  return (
    <nav aria-label={t({ ja: 'セットアップの段階', en: 'Setup steps' })} data-testid="setup-stepper">
      <ol className="flex flex-col gap-1">
        {steps.map((step, index) => {
          const open = step.id === current;
          return (
            <li key={step.id}>
              <button
                type="button"
                ref={(element) => {
                  buttons.current[index] = element;
                }}
                tabIndex={index === focusIndex ? 0 : -1}
                aria-current={open ? 'step' : undefined}
                data-testid={`setup-step-${step.id}`}
                data-status={step.status}
                onKeyDown={(event) => onKeyDown(event, index)}
                onFocus={() => setFocusIndex(index)}
                onClick={() => onOpen(step.id)}
                className={cx(
                  'flex w-full min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm',
                  open
                    ? 'border-accent-border bg-accent-soft font-semibold text-accent-on-soft'
                    : 'border-transparent hover:bg-surface-muted',
                )}
              >
                <span aria-hidden="true" className="w-5 shrink-0 text-right font-mono text-text-muted">
                  {step.order}
                </span>
                <span className="min-w-0 flex-1 truncate">{t(step.label)}</span>
                {step.optional ? <span className="shrink-0 text-xs text-text-muted">{t(OPTIONAL_TEXT)}</span> : null}
                <Badge tone={STEP_STATUS_TONE[step.status]} className="shrink-0">
                  {t(STEP_STATUS_TEXT[step.status])}
                </Badge>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
