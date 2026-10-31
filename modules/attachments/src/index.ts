// @daifuku/mod-attachments public API. Importing this module registers the attachment entity, actions and hooks.
import type { Infer, InsertInput, UpdateInput } from '@daifuku/kernel';
import type { Attachment } from './entities/attachment.ts';

export { AttachmentsModule } from './module.ts';
export { Attachment, ATTACHMENT_KINDS, type AttachmentKind } from './entities/attachment.ts';
export { searchAction } from './actions/search.ts';
export { supersedeAction } from './actions/supersede.ts';
export { linkAction } from './actions/link.ts';
export { forRecordAction } from './actions/for-record.ts';
export { evidenceSearchAction, evidenceSearchInput, type EvidenceSearchInput } from './actions/evidence-search.ts';
export { historyAction } from './actions/history.ts';
export {
  EVIDENCE_PAGE_DEFAULT,
  EVIDENCE_PAGE_MAX,
  HISTORY_LIMIT,
  HISTORY_RELATIONS,
  LINKED_KINDS,
  evidenceItemSchema,
  historyItemSchema,
  isIncomplete,
  type EvidenceItem,
  type HistoryItem,
  type HistoryRelation,
  type LinkedKind,
  type LinkedSummary,
  type SupersedeRecord,
} from './services/evidence.ts';
export { uploadAttachment, uploadFieldsSchema, UPLOAD_FIELDS, type UploadInput } from './actions/upload.ts';
export {
  MAX_UPLOAD_BYTES,
  ALLOWED_CONTENT_TYPES,
  validateUpload,
  normalizeContentType,
  basenameOf,
  cleanFormFields,
  assertSupersedable,
} from './services/validate.ts';
export {
  buildSearchDomain,
  INCOMPLETE_DOMAIN,
  SUPERSEDED_FILTERS,
  type SearchCriteria,
  type SupersededFilter,
} from './services/search.ts';
export { sha256Hex } from './services/hash.ts';

export type AttachmentRow = Infer<typeof Attachment>;
export type AttachmentInsert = InsertInput<typeof Attachment>;
export type AttachmentUpdate = UpdateInput<typeof Attachment>;
