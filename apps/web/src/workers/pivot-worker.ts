import { pivot, PivotError } from '../lib/pivot.ts';
import type { PivotWorkerInput, PivotWorkerReply } from '../lib/pivot-worker-client.ts';

// This worker receives only an authorized snapshot. It has no fetch or persistence capability in this code.
const scope = globalThis as unknown as {
  onmessage: (event: { data: PivotWorkerInput }) => void;
  postMessage(value: PivotWorkerReply): void;
};
scope.onmessage = ({ data }) => {
  try { scope.postMessage({ kind: 'result', result: pivot(data.rows, data.config) }); }
  catch (error) { scope.postMessage({ kind: 'error', code: error instanceof PivotError ? error.code : 'failed' }); }
};
