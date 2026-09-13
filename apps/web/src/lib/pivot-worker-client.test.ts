import { afterEach, describe, expect, it, vi } from 'vitest';
import { pivot, type PivotConfig } from './pivot.ts';
import { createPivotRunner, type PivotWorkerPort } from './pivot-worker-client.ts';

const config: PivotConfig = { rows: [], columns: [], measures: [{ field: 'amount', op: 'sum' }] };
const rows = [{ amount: '0.1' }],
  result = pivot(rows, config);
function port(): PivotWorkerPort {
  return { onmessage: null, onerror: null, postMessage: vi.fn(), terminate: vi.fn() };
}
function callbacks() {
  return { result: vi.fn(), pending: vi.fn(), failed: vi.fn() };
}
afterEach(() => vi.useRealTimers());
describe('pivot worker lifecycle', () => {
  it('terminates superseded workers and ignores their late results and errors', () => {
    const first = port(),
      second = port(),
      cb = callbacks();
    const runner = createPivotRunner(vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second), cb);
    runner.run(rows, config);
    runner.run([{ amount: '0.2' }], config);
    expect(first.terminate).toHaveBeenCalledOnce();
    first.onmessage?.({ data: { kind: 'result', result } });
    first.onerror?.();
    expect(cb.result).not.toHaveBeenCalled();
    expect(cb.failed).not.toHaveBeenCalled();
    second.onmessage?.({ data: { kind: 'result', result } });
    expect(cb.result).toHaveBeenCalledExactlyOnceWith(result);
    expect(second.terminate).toHaveBeenCalledOnce();
    expect(cb.pending).toHaveBeenLastCalledWith(false);
  });
  it('sends only the supplied snapshot/config and returns safe actionable errors', () => {
    const worker = port(),
      cb = callbacks(),
      runner = createPivotRunner(() => worker, cb);
    runner.run(rows, config);
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ rows, config });
    worker.onmessage?.({ data: { kind: 'error', code: 'cell_limit' } });
    expect(cb.failed).toHaveBeenCalledExactlyOnceWith('cell_limit');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(cb.result).not.toHaveBeenCalled();
  });
  it('cancels and discards a reply without surfacing failure', () => {
    const worker = port(),
      cb = callbacks(),
      runner = createPivotRunner(() => worker, cb);
    runner.run(rows, config);
    runner.cancel();
    worker.onmessage?.({ data: { kind: 'result', result } });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(cb.result).not.toHaveBeenCalled();
    expect(cb.failed).not.toHaveBeenCalled();
    expect(cb.pending).toHaveBeenLastCalledWith(false);
  });
  it('terminates computation after the time budget and ignores a late result', () => {
    vi.useFakeTimers();
    const worker = port(),
      cb = callbacks(),
      runner = createPivotRunner(() => worker, cb, 500);
    runner.run(rows, config);
    vi.advanceTimersByTime(501);
    worker.onmessage?.({ data: { kind: 'result', result } });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(cb.failed).toHaveBeenCalledExactlyOnceWith('timeout');
    expect(cb.result).not.toHaveBeenCalled();
  });
  it('handles unsupported workers and construction/post failures without leaking raw messages', () => {
    const cb = callbacks();
    createPivotRunner(() => null, cb).run(rows, config);
    expect(cb.failed).toHaveBeenLastCalledWith('unsupported');
    createPivotRunner(() => {
      throw new Error('private details');
    }, cb).run(rows, config);
    expect(cb.failed).toHaveBeenLastCalledWith('failed');
    const worker = port();
    worker.postMessage = () => {
      throw new Error('private details');
    };
    createPivotRunner(() => worker, cb).run(rows, config);
    expect(cb.failed).toHaveBeenLastCalledWith('failed');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('disposes on navigation without delivering state updates to a removed view', () => {
    const worker = port(),
      cb = callbacks(),
      runner = createPivotRunner(() => worker, cb);
    runner.run(rows, config);
    cb.pending.mockClear();
    runner.dispose();
    worker.onerror?.();
    worker.onmessage?.({ data: { kind: 'result', result } });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(cb.pending).not.toHaveBeenCalled();
    expect(cb.failed).not.toHaveBeenCalled();
    expect(cb.result).not.toHaveBeenCalled();
  });
});
