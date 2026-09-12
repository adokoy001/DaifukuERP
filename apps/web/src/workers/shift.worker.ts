import { recommendShift, type ShiftOptimizeOptions, type ShiftProblem } from '@daifuku/mod-workforce/scheduling';
import type { ShiftWorkerReply } from '../lib/shift-worker-client.ts';

// This worker receives a minimal planning snapshot. It never fetches or persists employee data.
const scope = globalThis as unknown as {
  onmessage: (event: { data: { problem: ShiftProblem; options: ShiftOptimizeOptions } }) => void;
  postMessage(value: ShiftWorkerReply): void;
};
scope.onmessage = ({ data }) => {
  try { scope.postMessage({ kind: 'result', result: recommendShift(data.problem, data.options) }); }
  catch { scope.postMessage({ kind: 'error' }); }
};
