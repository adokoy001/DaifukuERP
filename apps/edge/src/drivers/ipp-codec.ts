import { randomInt } from 'node:crypto';
import { EdgeError } from '../errors.ts';
export type IppValue = string | number | boolean | readonly [number, number];
export interface IppAttribute { name: string; tag: number; values: readonly IppValue[] }
export interface IppMessage { code: number; requestId: number; attributes: Map<string, IppValue[]> }
const short = (value: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(value); return b; };
function encoded(value: IppValue): Buffer {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (typeof value === 'boolean') return Buffer.from([value ? 1 : 0]);
  const result = Buffer.alloc(typeof value === 'number' ? 4 : 8);
  if (typeof value === 'number') result.writeInt32BE(value); else { result.writeInt32BE(value[0]); result.writeInt32BE(value[1], 4); } return result;
}
export function ippRequest(operation: number, uri: string, attributes: readonly IppAttribute[] = [], jobAttributes: readonly IppAttribute[] = [], document?: Buffer) {
  const requestId = randomInt(1, 2147483647), header = Buffer.alloc(8); header[0] = 1; header[1] = 1; header.writeUInt16BE(operation, 2); header.writeInt32BE(requestId, 4);
  const chunks: Buffer[] = [header];
  const group = (tag: number, values: readonly IppAttribute[]) => {
    if (!values.length) return; chunks.push(Buffer.from([tag]));
    for (const attribute of values) for (const [index, value] of attribute.values.entries()) { const name = Buffer.from(index ? '' : attribute.name), data = encoded(value); if (name.length > 255 || data.length > 65535) throw new EdgeError('ipp_attribute_too_large'); chunks.push(Buffer.from([attribute.tag]), short(name.length), name, short(data.length), data); }
  };
  group(1, [{ name: 'attributes-charset', tag: 0x47, values: ['utf-8'] }, { name: 'attributes-natural-language', tag: 0x48, values: ['en'] }, { name: 'printer-uri', tag: 0x45, values: [uri] }, ...attributes]); group(2, jobAttributes); chunks.push(Buffer.from([3])); if (document) chunks.push(document);
  return { body: Buffer.concat(chunks), requestId };
}
function value(tag: number, data: Buffer): IppValue {
  if ([0x21, 0x23].includes(tag)) { if (data.length !== 4) throw new EdgeError('invalid_ipp_integer'); return data.readInt32BE(); }
  if (tag === 0x22) { if (data.length !== 1 || (data[0] !== 0 && data[0] !== 1)) throw new EdgeError('invalid_ipp_boolean'); return data[0] === 1; }
  if (tag === 0x33) { if (data.length !== 8) throw new EdgeError('invalid_ipp_range'); return [data.readInt32BE(), data.readInt32BE(4)]; }
  if (tag >= 0x41 && tag <= 0x49) return new TextDecoder('utf-8', { fatal: true }).decode(data);
  return ''; // Unsupported attribute types are never interpreted as commands or destinations.
}
export function parseIpp(body: Buffer, requestId?: number): IppMessage {
  if (body.length < 9 || body.length > 262144 || ![1, 2].includes(body[0] ?? 0)) throw new EdgeError('invalid_ipp_response');
  const actual = body.readInt32BE(4); if (requestId !== undefined && actual !== requestId) throw new EdgeError('ipp_request_mismatch');
  const attributes = new Map<string, IppValue[]>(); let position = 8, name = '', count = 0, group = 0;
  while (position < body.length) {
    const tag = body[position++]; if (tag === 3) return { code: body.readUInt16BE(2), requestId: actual, attributes };
    if (tag !== undefined && tag < 0x10) { if (![1, 2, 4, 5, 6, 7, 9].includes(tag)) throw new EdgeError('invalid_ipp_group'); group = tag; name = ''; continue; }
    if (!group || tag === undefined || position + 2 > body.length || ++count > 2048) throw new EdgeError('invalid_ipp_response');
    const length = body.readUInt16BE(position); position += 2; if (position + length + 2 > body.length) throw new EdgeError('truncated_ipp_response');
    if (length) { name = body.subarray(position, position + length).toString('ascii'); if (!/^[a-z0-9-]{1,255}$/.test(name)) throw new EdgeError('invalid_ipp_attribute'); } else if (!name) throw new EdgeError('invalid_ipp_continuation');
    position += length; const valueLength = body.readUInt16BE(position); position += 2; if (position + valueLength > body.length) throw new EdgeError('truncated_ipp_response');
    const decoded = value(tag, body.subarray(position, position + valueLength)); position += valueLength;
    if (group === 1 || group === 2 || group === 4) attributes.set(name, [...(attributes.get(name) ?? []), decoded]);
  }
  throw new EdgeError('missing_ipp_end');
}
