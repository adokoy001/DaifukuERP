import { afterEach, describe, expect, it, vi } from 'vitest';
import { PasswordWorkQueue } from '../src/password-work-queue.ts';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());
describe('password work resource budget', () => {
  it('bounds active and waiting work, rejects excess and starts waiting work in order', async () => {
    const queue = new PasswordWorkQueue(2, 1, 5000);
    const first = deferred();
    const second = deferred();
    const started: number[] = [];
    const a = queue.run(async () => {
      started.push(1);
      await first.promise;
    });
    const b = queue.run(async () => {
      started.push(2);
      await second.promise;
    });
    const c = queue.run(async () => {
      started.push(3);
      return 'third';
    });
    await expect(queue.run(async () => 'excess')).rejects.toMatchObject({ httpStatus: 503 });
    expect(started).toEqual([1, 2]);
    second.resolve();
    await b;
    await expect(c).resolves.toBe('third');
    expect(started).toEqual([1, 2, 3]);
    first.resolve();
    await a;
  });
  it('expires queued work without starting it or freeing the active job prematurely', async () => {
    vi.useFakeTimers();
    const queue = new PasswordWorkQueue(1, 1, 5000);
    const active = deferred();
    const a = queue.run(() => active.promise);
    const never = vi.fn(async () => true);
    const b = queue.run(never);
    const rejected = expect(b).rejects.toMatchObject({ httpStatus: 503 });
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    const replacement = queue.run(async () => 'replacement');
    await expect(queue.run(async () => 'excess')).rejects.toMatchObject({ httpStatus: 503 });
    expect(never).not.toHaveBeenCalled();
    active.resolve();
    await a;
    await expect(replacement).resolves.toBe('replacement');
    expect(never).not.toHaveBeenCalled();
  });
  it('releases an active slot after asynchronous rejection and synchronous work errors', async () => {
    const queue = new PasswordWorkQueue(1, 2, 5000);
    const failed = queue.run(() => {
      throw new Error('synthetic');
    });
    const failedAsync = queue.run(async () => {
      throw new Error('synthetic async');
    });
    const next = queue.run(async () => 'recovered');
    await expect(failed).rejects.toThrow('synthetic');
    await expect(failedAsync).rejects.toThrow('synthetic async');
    await expect(next).resolves.toBe('recovered');
  });
});
