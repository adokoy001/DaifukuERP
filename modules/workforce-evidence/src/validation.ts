import { ValidationError } from '@daifuku/kernel';
import { validateUpload } from '@daifuku/mod-attachments';

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export interface ReceiptUpload { data: Uint8Array; filename: string; contentType: string; expectedVersion: number }
const formats = new Map<string, readonly number[]>([
  ['image/png', [137, 80, 78, 71, 13, 10, 26, 10]],
  ['image/jpeg', [255, 216, 255]],
  ['application/pdf', [37, 80, 68, 70, 45]],
]);
/** An allowlist plus byte signature; not a malware scanner or full image/PDF parser. */
export function validateReceipt(input: ReceiptUpload): { filename: string; contentType: string; size: number } {
  const meta = validateUpload({ filename: input.filename, contentType: input.contentType, size: input.data.byteLength });
  const signature = formats.get(meta.contentType);
  if (!signature || !signature.every((byte, index) => input.data[index] === byte)) throw new ValidationError('Receipt type and file signature must match PNG, JPEG or PDF.', [{ path: 'file', message: 'Unsupported or mismatched content.' }]);
  if (meta.size > MAX_RECEIPT_BYTES) throw new ValidationError('Receipt exceeds 10 MB.', [{ path: 'file', message: 'Choose a smaller file.' }]);
  if ([...meta.filename].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new ValidationError('Receipt filename contains control characters.', [{ path: 'file.filename', message: 'Rename the file.' }]);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new ValidationError('Expense version is required.', [{ path: 'expectedVersion', message: 'Reload the expense first.' }]);
  return meta;
}
