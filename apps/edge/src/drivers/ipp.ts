import { setTimeout as delay } from 'node:timers/promises';
import type { EdgeJobRequest, EdgeResult } from '@daifuku/mod-edge-integration/contract';
import type { DeviceConfig, EdgeConfig } from '../config.ts';
import { validateUrl } from '../config.ts';
import { bytesRequest } from '../http.ts';
import { EdgeError } from '../errors.ts';
import { ippRequest, parseIpp, type IppAttribute, type IppMessage } from './ipp-codec.ts';
type Printer = Extract<DeviceConfig, { driver: 'ipp_text' }>;
export interface DriverContext { signal: AbortSignal; canSend: () => boolean; accepted: (reference: string) => Promise<void> }
export interface IppTransport { (operation: number, attributes?: readonly IppAttribute[], jobAttributes?: readonly IppAttribute[], document?: Buffer): Promise<IppMessage> }
export function printerTransport(device: Printer, config: EdgeConfig, signal: AbortSignal): IppTransport {
  const original = validateUrl(device.printerUri, ['ipp:', 'ipps:']), url = new URL(original.href.replace(/^ipps:/, 'https:').replace(/^ipp:/, 'http:'));
  if (!original.port) url.port = '631';
  return async (operation, attributes, jobAttributes, document) => {
    const request = ippRequest(operation, original.href, attributes, jobAttributes, document);
    const response = await bytesRequest(url, 'POST', { 'content-type': 'application/ipp', 'content-length': String(request.body.length) }, request.body, { timeoutMs: config.requestTimeoutMs, limitBytes: 262144, signal, ...(device.caFile ? { caFile: device.caFile } : {}) });
    if (response.status !== 200 || response.type.split(';')[0]?.trim().toLowerCase() !== 'application/ipp') throw new EdgeError('ipp_transport_rejected'); return parseIpp(response.body, request.requestId);
  };
}
const requested = (names: string[]): IppAttribute => ({ name: 'requested-attributes', tag: 0x44, values: names });
export async function printerStatus(transport: IppTransport): Promise<EdgeResult> {
  const response = await transport(0x000b, [requested(['printer-state', 'printer-is-accepting-jobs'])]);
  if (response.code !== 0) return { state: 'failed', code: 'ipp_status_unavailable' };
  const state = response.attributes.get('printer-state')?.[0];
  if (state === 3 || state === 4) return { state: 'succeeded', code: state === 3 ? 'ipp_online' : 'ipp_busy' };
  return { state: 'failed', code: 'ipp_not_ready' };
}
function formatFor(text: string, response: IppMessage): string | null {
  const formats = response.attributes.get('document-format-supported')?.filter((item): item is string => typeof item === 'string').map((item) => item.toLowerCase().replace(/\s/g, '')) ?? [];
  if (formats.includes('text/plain;charset=utf-8')) return 'text/plain; charset=utf-8';
  if (!Array.from(text).some((character) => character.charCodeAt(0) > 127) && (formats.includes('text/plain') || formats.includes('text/plain;charset=us-ascii'))) return 'text/plain';
  return null;
}
function copiesSupported(copies: number, response: IppMessage): boolean {
  return copies === 1 || (response.attributes.get('copies-supported') ?? []).some((value) => Array.isArray(value) ? copies >= Number(value[0]) && copies <= Number(value[1]) : value === copies);
}
export function terminalJob(response: IppMessage, reference: string): EdgeResult | null {
  if (response.code !== 0) return { state: 'uncertain', code: 'ipp_job_unavailable', deviceJobId: reference };
  const state = response.attributes.get('job-state')?.[0], reasons = response.attributes.get('job-state-reasons') ?? [];
  if (state === 9) {
    if (reasons.some((reason) => typeof reason === 'string' && /queued-in-device|completed-with-errors|completed-with-warnings/.test(reason))) return { state: 'uncertain', code: 'ipp_completion_needs_review', deviceJobId: reference };
    return { state: 'succeeded', code: 'ipp_reported_completed', deviceJobId: reference };
  }
  if (state === 7 || state === 8) return { state: 'failed', code: state === 7 ? 'ipp_cancelled' : 'ipp_aborted', deviceJobId: reference };
  if (![3, 4, 5, 6].includes(Number(state))) return { state: 'uncertain', code: 'ipp_unknown_job_state', deviceJobId: reference };
  return null;
}
export async function observePrint(transport: IppTransport, reference: string, waitMs: number, signal: AbortSignal): Promise<EdgeResult> {
  const id = Number(reference); if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647 || String(id) !== reference) throw new EdgeError('invalid_local_print_reference');
  const end = Date.now() + waitMs;
  while (!signal.aborted && Date.now() < end) {
    const response = await transport(0x0009, [{ name: 'job-id', tag: 0x21, values: [id] }, requested(['job-id', 'job-state', 'job-state-reasons'])]);
    if (response.attributes.get('job-id')?.[0] !== id) return { state: 'uncertain', code: 'ipp_job_identity_mismatch', deviceJobId: reference };
    const result = terminalJob(response, reference); if (result) return result;
    await delay(Math.min(1000, Math.max(1, end - Date.now())), undefined, { signal }).catch(() => undefined);
  }
  return { state: 'uncertain', code: 'ipp_completion_timeout', deviceJobId: reference };
}
export async function printText(transport: IppTransport, request: Extract<EdgeJobRequest, { kind: 'print.text' }>, context: DriverContext, waitMs: number): Promise<EdgeResult> {
  if (Array.from(request.payload.text).some((character) => { const code = character.charCodeAt(0); return (code < 32 && ![9, 10, 13].includes(code)) || (code >= 127 && code <= 159); })) return { state: 'failed', code: 'text_control_characters_rejected' };
  let attributes: IppMessage;
  try { attributes = await transport(0x000b, [requested(['document-format-supported', 'copies-supported', 'printer-is-accepting-jobs'])]); } catch { return { state: 'failed', code: 'ipp_probe_failed' }; }
  if (attributes.code !== 0 || attributes.attributes.get('printer-is-accepting-jobs')?.[0] !== true) return { state: 'failed', code: 'ipp_not_accepting_jobs' };
  const format = formatFor(request.payload.text, attributes);
  if (!format || !copiesSupported(request.payload.copies, attributes)) return { state: 'failed', code: !format ? 'ipp_text_format_unsupported' : 'ipp_copies_unsupported' };
  if (!context.canSend() || context.signal.aborted) return { state: 'uncertain', code: 'execution_permission_lost' };
  // From this call onward, a timeout is ambiguous; the caller never retries Print-Job.
  const response = await transport(0x0002, [{ name: 'document-format', tag: 0x49, values: [format] }, { name: 'ipp-attribute-fidelity', tag: 0x22, values: [true] }, { name: 'job-name', tag: 0x42, values: [request.payload.title] }], [{ name: 'copies', tag: 0x21, values: [request.payload.copies] }], Buffer.from(request.payload.text, 'utf8'));
  const id = response.attributes.get('job-id')?.[0];
  if (response.code > 0x00ff && response.code < 0x0400) return { state: 'uncertain', code: 'ipp_unknown_acceptance' };
  if (response.code >= 0x0400) return { state: 'failed', code: 'ipp_print_rejected' };
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return { state: 'uncertain', code: 'ipp_acceptance_without_job_id' };
  await context.accepted(String(id));
  return observePrint(transport, String(id), waitMs, context.signal);
}
