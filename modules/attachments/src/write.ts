import { defineWriteCapability, withWriteCapability, type Context } from '@daifuku/kernel';

const upload = defineWriteCapability({ name: 'attachments.upload', entity: 'attachment', fields: ['storageKey', 'filename', 'contentType', 'size', 'sha256'], operations: ['create'] });
const supersede = defineWriteCapability({ name: 'attachments.supersede', entity: 'attachment', fields: ['supersededById'], operations: ['update'] });
export const withUpload = <T>(ctx: Context, work: (ctx: Context) => Promise<T>): Promise<T> => withWriteCapability(ctx, upload, work);
export const withSupersede = <T>(ctx: Context, work: (ctx: Context) => Promise<T>): Promise<T> => withWriteCapability(ctx, supersede, work);
