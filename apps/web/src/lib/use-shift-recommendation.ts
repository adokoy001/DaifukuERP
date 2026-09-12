import { useEffect, useMemo, useState } from 'react';
import type { ShiftAssignment, ShiftProblem, ShiftRecommendation } from '@daifuku/mod-workforce/scheduling';
import { useLocale } from '../i18n.tsx';
import { createShiftRunner, type ShiftWorkerFailure, type ShiftWorkerPort } from './shift-worker-client.ts';

function workerFactory(): ShiftWorkerPort | null {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('../workers/shift.worker.ts', import.meta.url), { type: 'module' }) as unknown as ShiftWorkerPort;
}
export function useShiftRecommendation(scopeKey: string, problem: ShiftProblem | undefined) {
  const { t } = useLocale();
  const [result, setResult] = useState<ShiftRecommendation | null>(null), [running, setRunning] = useState(false), [failure, setFailure] = useState<ShiftWorkerFailure | null>(null);
  const runner = useMemo(() => createShiftRunner(workerFactory, { result: setResult, pending: setRunning, failed: setFailure }), []);
  const problemKey = JSON.stringify(problem);
  useEffect(() => { runner.cancel(); setResult(null); setFailure(null); return () => runner.dispose(); }, [runner, scopeKey, problemKey]);
  const clear = () => { runner.cancel(); setResult(null); setFailure(null); };
  const recommend = (assignments: ShiftAssignment[], seed: number) => { if (!problem) return; setResult(null); setFailure(null); runner.run(problem, { assignments, seed }); };
  const errors: Record<ShiftWorkerFailure, { ja: string; en: string }> = {
    unsupported: { ja: 'このブラウザーはシフト計算に対応していません。対応ブラウザーで開くか、手動で割り当ててください。', en: 'This browser cannot run the planner. Use a supported browser or assign shifts manually.' },
    failed: { ja: 'シフトを計算できませんでした。入力を確認して再実行してください。', en: 'The shift calculation failed. Check the inputs and try again.' },
    timeout: { ja: '計算の制限時間に達しました。枠を減らすか、固定する割当を増やして再実行してください。', en: 'The calculation timed out. Reduce the slots or lock more assignments and try again.' },
  };
  return { result, running, error: failure ? t(errors[failure]) : null, recommend, cancel: () => runner.cancel(), clear };
}
