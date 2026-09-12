import type { ShiftOptimizeOptions, ShiftProblem, ShiftRecommendation } from '@daifuku/mod-workforce/scheduling';

export type ShiftWorkerReply = { kind: 'result'; result: ShiftRecommendation } | { kind: 'error' };
export interface ShiftWorkerPort {
  onmessage: ((event: { data: ShiftWorkerReply }) => void) | null;
  onerror: (() => void) | null;
  postMessage(input: { problem: ShiftProblem; options: ShiftOptimizeOptions }): void;
  terminate(): void;
}
export type ShiftWorkerFailure = 'unsupported' | 'failed' | 'timeout';
interface Callbacks { result(value: ShiftRecommendation): void; failed(code: ShiftWorkerFailure): void; pending(value: boolean): void }
/** A fresh worker per calculation. Stale replies can never reach a newer request. */
export function createShiftRunner(factory: () => ShiftWorkerPort | null, callbacks: Callbacks, timeoutMs = 20000) {
  let current: ShiftWorkerPort | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => { if (timeout !== undefined) clearTimeout(timeout); timeout = undefined; current?.terminate(); current = null; };
  const finish = (worker: ShiftWorkerPort, outcome: () => void) => { if (current !== worker) return; dispose(); callbacks.pending(false); outcome(); };
  return {
    run(problem: ShiftProblem, options: ShiftOptimizeOptions) {
      dispose();
      let worker: ShiftWorkerPort | null;
      try { worker = factory(); } catch { callbacks.pending(false); callbacks.failed('failed'); return; }
      if (!worker) { callbacks.pending(false); callbacks.failed('unsupported'); return; }
      current = worker; callbacks.pending(true);
      worker.onmessage = ({ data }) => finish(worker, () => { if (data.kind === 'result') callbacks.result(data.result); else callbacks.failed('failed'); });
      worker.onerror = () => finish(worker, () => callbacks.failed('failed'));
      timeout = setTimeout(() => finish(worker, () => callbacks.failed('timeout')), timeoutMs);
      try { worker.postMessage({ problem, options }); } catch { finish(worker, () => callbacks.failed('failed')); }
    },
    cancel() { dispose(); callbacks.pending(false); },
    dispose,
  };
}
