import { DaifukuError } from './errors.ts';

export function passwordWorkUnavailable(): DaifukuError {
  return new DaifukuError(
    'INTERNAL',
    'Password verification is temporarily busy.',
    'Wait briefly and retry.',
    undefined,
    503,
  );
}

/** Process-local resource budget. Active crypto jobs keep their slot until their callback finishes. */
export class PasswordWorkQueue {
  private active = 0;
  private readonly pending: { start(): void }[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly capacity: number,
    private readonly waitMs: number,
  ) {
    if (
      !Number.isSafeInteger(concurrency) ||
      concurrency < 1 ||
      !Number.isSafeInteger(capacity) ||
      capacity < 0 ||
      !Number.isSafeInteger(waitMs) ||
      waitMs < 1
    )
      throw new Error('Invalid password work budget.');
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const entry = {
        start: () => {
          if (timer) clearTimeout(timer);
          this.active++;
          void Promise.resolve()
            .then(work)
            .then(resolve, reject)
            .finally(() => {
              this.active--;
              this.pending.shift()?.start();
            });
        },
      };
      if (this.active < this.concurrency) entry.start();
      else if (this.pending.length >= this.capacity) reject(passwordWorkUnavailable());
      else {
        this.pending.push(entry);
        timer = setTimeout(() => {
          const index = this.pending.indexOf(entry);
          if (index < 0) return;
          this.pending.splice(index, 1);
          reject(passwordWorkUnavailable());
        }, this.waitMs);
      }
    });
  }
}
