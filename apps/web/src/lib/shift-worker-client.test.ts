import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShiftProblem, ShiftRecommendation } from '@daifuku/mod-workforce/scheduling';
import { createShiftRunner, type ShiftWorkerPort } from './shift-worker-client.ts';
const problem = {} as ShiftProblem,
  recommendation = { seed: 7 } as ShiftRecommendation;
function port(): ShiftWorkerPort {
  return { onmessage: null, onerror: null, postMessage: vi.fn(), terminate: vi.fn() };
}
function callbacks() {
  return { result: vi.fn(), pending: vi.fn(), failed: vi.fn() };
}
afterEach(() => vi.useRealTimers());
describe('shift worker lifecycle', () => {
  it('terminates completed workers and delivers only the current result', () => {
    const first = port(),
      second = port(),
      cb = callbacks(),
      factory = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
      runner = createShiftRunner(factory, cb);
    runner.run(problem, { seed: 7 });
    runner.run(problem, { seed: 8 });
    expect(first.terminate).toHaveBeenCalledOnce();
    first.onmessage?.({ data: { kind: 'result', result: recommendation } });
    expect(cb.result).not.toHaveBeenCalled();
    second.onmessage?.({ data: { kind: 'result', result: recommendation } });
    expect(cb.result).toHaveBeenCalledOnce();
    expect(second.terminate).toHaveBeenCalledOnce();
    expect(cb.pending).toHaveBeenLastCalledWith(false);
  });
  it('cancels a running request and ignores its late reply', () => {
    const worker = port(),
      cb = callbacks(),
      runner = createShiftRunner(() => worker, cb);
    runner.run(problem, { seed: 7 });
    runner.cancel();
    worker.onmessage?.({ data: { kind: 'result', result: recommendation } });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(cb.result).not.toHaveBeenCalled();
    expect(cb.failed).not.toHaveBeenCalled();
  });
  it('bounds computation time and terminates before reporting a timeout', () => {
    vi.useFakeTimers();
    const worker = port(),
      cb = callbacks(),
      runner = createShiftRunner(() => worker, cb, 500);
    runner.run(problem, { seed: 7 });
    vi.advanceTimersByTime(501);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(cb.failed).toHaveBeenCalledWith('timeout');
    expect(cb.pending).toHaveBeenLastCalledWith(false);
  });
  it('reports unsupported workers and construction/post failures without raw exceptions', () => {
    const cb = callbacks();
    createShiftRunner(() => null, cb).run(problem, { seed: 1 });
    expect(cb.failed).toHaveBeenLastCalledWith('unsupported');
    createShiftRunner(() => {
      throw new Error('private source');
    }, cb).run(problem, { seed: 1 });
    expect(cb.failed).toHaveBeenLastCalledWith('failed');
    const worker = port();
    worker.postMessage = () => {
      throw new Error('private source');
    };
    createShiftRunner(() => worker, cb).run(problem, { seed: 1 });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(cb.failed).toHaveBeenLastCalledWith('failed');
  });
  it('disposes on navigation without accepting future errors or updating a removed view', () => {
    const worker = port(),
      cb = callbacks(),
      runner = createShiftRunner(() => worker, cb);
    runner.run(problem, { seed: 7 });
    cb.pending.mockClear();
    runner.dispose();
    worker.onerror?.();
    expect(cb.failed).not.toHaveBeenCalled();
    expect(cb.pending).not.toHaveBeenCalled();
  });
});
