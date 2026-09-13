import type { PivotConfig, PivotErrorCode, PivotResult } from './pivot.ts';

export interface PivotWorkerInput { rows: readonly Record<string, unknown>[]; config: PivotConfig }
export type PivotWorkerReply = { kind: 'result'; result: PivotResult } | { kind: 'error'; code: PivotErrorCode | 'failed' };
export interface PivotWorkerPort {
  onmessage: ((event: { data: PivotWorkerReply }) => void) | null;
  onerror: (() => void) | null;
  postMessage(input: PivotWorkerInput): void;
  terminate(): void;
}
export type PivotWorkerFailure = PivotErrorCode | 'unsupported' | 'failed' | 'timeout';
interface Callbacks { result(value: PivotResult): void; failed(code: PivotWorkerFailure): void; pending(value: boolean): void }

/** One fresh worker per calculation. Termination cancels CPU work as well as discarding stale replies. */
export function createPivotRunner(factory: () => PivotWorkerPort | null, callbacks: Callbacks, timeoutMs = 20_000) {
  let current: PivotWorkerPort | null = null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => { if (timeout !== undefined) clearTimeout(timeout); timeout = undefined; current?.terminate(); current = null; };
  const finish = (worker: PivotWorkerPort, outcome: () => void) => { if (current !== worker) return; dispose(); callbacks.pending(false); outcome(); };
  return {
    run(rows: readonly Record<string, unknown>[], config: PivotConfig) {
      dispose();
      let worker: PivotWorkerPort | null;
      try { worker = factory(); } catch { callbacks.pending(false); callbacks.failed('failed'); return; }
      if (!worker) { callbacks.pending(false); callbacks.failed('unsupported'); return; }
      current = worker;
      callbacks.pending(true);
      worker.onmessage = ({ data }) => finish(worker, () => { if (data.kind === 'result') callbacks.result(data.result); else callbacks.failed(data.code); });
      worker.onerror = () => finish(worker, () => callbacks.failed('failed'));
      timeout = setTimeout(() => finish(worker, () => callbacks.failed('timeout')), timeoutMs);
      try { worker.postMessage({ rows, config }); } catch { finish(worker, () => callbacks.failed('failed')); }
    },
    cancel() { dispose(); callbacks.pending(false); },
    dispose,
  };
}
