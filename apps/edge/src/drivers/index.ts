import type { EdgeClaimedJob, EdgeResult } from '@daifuku/mod-edge-integration/contract';
import { deviceBindingHash, type DeviceConfig, type EdgeConfig } from '../config.ts';
import { EdgeError } from '../errors.ts';
import type { JournalRecord } from '../journal.ts';
import { observePrint, printerStatus, printerTransport, printText, type DriverContext } from './ipp.ts';
export function localDevice(config: EdgeConfig, job: Pick<EdgeClaimedJob, 'deviceId' | 'localDeviceId' | 'driver'>): DeviceConfig {
  const device = config.devices.find((row) => row.deviceId === job.deviceId && row.localDeviceId === job.localDeviceId && row.driver === job.driver);
  if (!device) throw new EdgeError('device_not_allowlisted'); return device;
}
export async function executeDevice(config: EdgeConfig, job: EdgeClaimedJob, context: DriverContext): Promise<EdgeResult> {
  const device = localDevice(config, job);
  if (device.driver === 'simulator') {
    if (!context.canSend() || context.signal.aborted) return { state: 'uncertain', code: 'execution_permission_lost' };
    return { state: 'succeeded', code: job.request.kind === 'cash.dispense' ? 'simulated_cash_dispense' : job.request.kind === 'print.text' ? 'simulated_print' : 'simulator_online', summary: 'SIMULATION ONLY: no physical device operation.' };
  }
  const transport = printerTransport(device, config, context.signal);
  if (job.request.kind === 'cash.dispense') return { state: 'failed', code: 'unsupported_device_operation' };
  if (job.request.kind === 'device.status') { try { return await printerStatus(transport); } catch { return { state: 'failed', code: 'ipp_status_unavailable' }; } }
  return printText(transport, job.request, context, config.printWaitMs);
}
export async function recoverDevice(config: EdgeConfig, row: JournalRecord, signal: AbortSignal): Promise<EdgeResult> {
  if (row.localConfigHash !== deviceBindingHash(config, row.deviceId)) return { state: 'uncertain', code: 'local_device_mapping_changed' };
  const device = localDevice(config, row);
  if (device.driver !== 'ipp_text' || !row.deviceJobId) return { state: 'uncertain', code: 'agent_restarted_after_start' };
  return observePrint(printerTransport(device, config, signal), row.deviceJobId, config.printWaitMs, signal);
}
