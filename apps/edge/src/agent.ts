import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { EDGE_POLL_MS, type EdgeResult } from '@daifuku/mod-edge-integration/contract';
import type { Credentials } from './credentials.ts';
import { recoverDevice } from './drivers/index.ts';
import { EdgeError, errorCode } from './errors.ts';
import { leaseOf, performJob } from './execution.ts';
import type { Journal, JournalRecord } from './journal.ts';
import { notifications, Wakeup } from './notifications.ts';
export class EdgeAgent {
  constructor(
    readonly credentials: Credentials,
    readonly journal: Journal,
    private readonly log: (code: string) => void = () => undefined,
  ) {}
  private async report(row: JournalRecord): Promise<void> {
    if (!row.result) throw new EdgeError('journal_result_missing');
    const response = await this.credentials.client.complete(leaseOf(row), row.result);
    if (!response.accepted) {
      if (response.ignored === 'obsolete_attempt' || response.ignored === 'manually_resolved') {
        await this.journal.acknowledged(row);
        this.log('job_result_' + response.ignored);
        return;
      }
      throw new EdgeError('job_result_not_accepted');
    }
    // The persisted result timestamp is the observation time; a later ACK must not refresh it.
    await this.journal.reported(row, {
      eventId: randomUUID(),
      deviceId: row.deviceId,
      localDeviceId: row.localDeviceId,
      observedAt: row.updatedAt,
      status:
        row.result.state === 'succeeded'
          ? row.result.code === 'ipp_busy'
            ? 'busy'
            : 'online'
          : row.result.state === 'uncertain'
            ? 'unknown'
            : 'error',
      code: row.result.code,
    });
    this.log('job_' + row.result.state);
  }
  private async recovery(signal: AbortSignal): Promise<void> {
    for (const initial of this.journal.records().filter((row) => row.phase !== 'reported')) {
      let row = initial;
      if (!row.result) {
        let result: EdgeResult;
        try {
          result = await recoverDevice(this.credentials.client.config, row, signal);
        } catch {
          result = { state: 'uncertain', code: 'recovery_requires_review' };
        }
        row = await this.journal.update(row.jobId, { result });
      }
      await this.report(row);
    }
    for (const event of [...this.journal.events()]) {
      const response = await this.credentials.client.event(event);
      await this.journal.eventReported(event.eventId);
      if (response.ignored === 'expired') this.log('device_event_expired');
    }
  }
  async tick(signal: AbortSignal): Promise<boolean> {
    await this.recovery(signal);
    if (signal.aborted) return false;
    const response = await this.credentials.client.claim();
    const job = response.job;
    if (!job) return false;
    if (this.journal.records().some((row) => row.jobId === job.id)) {
      await this.credentials.client.complete(
        { jobId: job.id, leaseToken: job.leaseToken, attempt: job.attempt },
        { state: 'uncertain', code: 'prior_attempt_requires_review' },
      );
      return true;
    }
    const row = await performJob(this.credentials.client, this.journal, job, signal);
    await this.report(row);
    return true;
  }
  async run(signal: AbortSignal): Promise<void> {
    await this.credentials.session();
    const wake = new Wakeup();
    const notificationAbort = new AbortController();
    const stop = () => notificationAbort.abort();
    signal.addEventListener('abort', stop, { once: true });
    const notified = notifications(
      this.credentials.client.config,
      () => this.credentials.authorization(),
      () => wake.wake(),
      notificationAbort.signal,
    ).catch(() => this.log('notifications_unavailable'));
    this.log('agent_started');
    try {
      while (!signal.aborted) {
        try {
          const session = await this.credentials.session();
          if (Date.parse(session.credentialExpiresAt) - Date.parse(session.serverTime) < 300000) {
            await this.credentials.rotate();
            this.log('credential_rotated');
          }
          const worked = await this.tick(signal);
          if (worked) await delay(250, undefined, { signal }).catch(() => undefined);
          else await wake.wait(Math.round(EDGE_POLL_MS * (0.8 + Math.random() * 0.4)), signal);
        } catch (error) {
          this.log(errorCode(error));
          if (
            !(error instanceof EdgeError) ||
            !['transport_failed', 'relay_request_rejected', 'job_result_not_accepted'].includes(error.code)
          )
            throw error;
          await delay(EDGE_POLL_MS, undefined, { signal }).catch(() => undefined);
        }
      }
    } finally {
      notificationAbort.abort();
      signal.removeEventListener('abort', stop);
      await notified;
      this.log('agent_stopped');
    }
  }
}
