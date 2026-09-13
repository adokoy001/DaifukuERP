import { join } from 'node:path';
import { z } from 'zod';
import {
  edgeDeviceDriver,
  edgeEventInput,
  edgeLease,
  edgeResult,
  type EdgeClaimedJob,
  type EdgeDeviceEvent,
  type EdgeResult,
} from '@daifuku/mod-edge-integration/contract';
import { EdgeError } from './errors.ts';
import { missingFile, readPrivateJson, syncJson } from './files.ts';
const record = edgeLease
  .extend({
    deviceId: z.uuid(),
    localDeviceId: z.string(),
    driver: edgeDeviceDriver,
    localConfigHash: z.string().regex(/^[a-f0-9]{64}$/),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
    phase: z.enum(['starting', 'executing', 'accepted', 'reported']),
    deviceJobId: z.string().optional(),
    result: edgeResult.optional(),
    updatedAt: z.string(),
  })
  .strict();
const schema = z
  .object({ version: z.literal(1), records: z.array(record).max(1000), events: z.array(edgeEventInput).max(1000) })
  .strict();
export type JournalRecord = z.infer<typeof record>;
export class Journal {
  private constructor(
    private readonly path: string,
    private data: z.infer<typeof schema>,
  ) {}
  static async open(directory: string): Promise<Journal> {
    const path = join(directory, 'journal.json');
    let data: z.infer<typeof schema> = { version: 1, records: [], events: [] };
    try {
      const parsed = schema.safeParse(await readPrivateJson(path));
      if (!parsed.success) throw new EdgeError('invalid_journal');
      data = parsed.data;
    } catch (error) {
      if (!missingFile(error)) throw error;
    }
    return new Journal(path, data);
  }
  records(): readonly JournalRecord[] {
    return this.data.records;
  }
  events(): readonly EdgeDeviceEvent[] {
    return this.data.events;
  }
  private async save(data: z.infer<typeof schema>): Promise<void> {
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new EdgeError('journal_capacity_exceeded');
    await syncJson(this.path, data);
    this.data = data;
  }
  async begin(job: EdgeClaimedJob, localConfigHash: string): Promise<JournalRecord> {
    if (this.data.records.some((row) => row.jobId === job.id)) throw new EdgeError('job_already_recorded');
    const row: JournalRecord = {
      jobId: job.id,
      deviceId: job.deviceId,
      localDeviceId: job.localDeviceId,
      driver: job.driver,
      localConfigHash,
      payloadHash: job.payloadHash,
      leaseToken: job.leaseToken,
      attempt: job.attempt,
      phase: 'starting',
      updatedAt: new Date().toISOString(),
    };
    const retained = this.data.records
      .filter((item) => item.phase !== 'reported')
      .concat(this.data.records.filter((item) => item.phase === 'reported').slice(-400));
    await this.save({ ...this.data, records: [...retained, row] });
    return row;
  }
  async update(
    jobId: string,
    patch: { phase?: JournalRecord['phase']; deviceJobId?: string; result?: EdgeResult },
  ): Promise<JournalRecord> {
    const original = this.data.records.find((row) => row.jobId === jobId);
    if (!original) throw new EdgeError('journal_record_missing');
    const changed = { ...original, ...patch, updatedAt: new Date().toISOString() };
    await this.save({ ...this.data, records: this.data.records.map((row) => (row.jobId === jobId ? changed : row)) });
    return changed;
  }
  async reported(row: JournalRecord, event: EdgeDeviceEvent): Promise<void> {
    await this.save({
      ...this.data,
      records: this.data.records.map((item) =>
        item.jobId === row.jobId ? { ...item, phase: 'reported' as const, updatedAt: new Date().toISOString() } : item,
      ),
      events: [...this.data.events, event],
    });
  }
  async acknowledged(row: JournalRecord): Promise<void> {
    await this.save({
      ...this.data,
      records: this.data.records.map((item) =>
        item.jobId === row.jobId ? { ...item, phase: 'reported' as const, updatedAt: new Date().toISOString() } : item,
      ),
    });
  }
  async event(event: EdgeDeviceEvent): Promise<void> {
    await this.save({ ...this.data, events: [...this.data.events, event] });
  }
  async eventReported(id: string): Promise<void> {
    await this.save({ ...this.data, events: this.data.events.filter((row) => row.eventId !== id) });
  }
}
