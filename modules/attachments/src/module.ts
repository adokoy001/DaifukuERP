// Module manifest (docs/conventions/layers.md). Depends on partner for the 取引先 search key.
import { defineModule, label } from '@daifuku/kernel';
import { forRecordAction } from './actions/for-record.ts';
import { linkAction } from './actions/link.ts';
import { searchAction } from './actions/search.ts';
import { supersedeAction } from './actions/supersede.ts';
import { Attachment } from './entities/attachment.ts';
import { registerIntegrityHooks } from './hooks/integrity.ts';

export const AttachmentsModule = defineModule({
  name: 'attachment',
  label: label('証憑・添付', 'Attachments'),
  depends: ['partner'],
  entities: [Attachment],
  actions: [searchAction, supersedeAction, linkAction, forRecordAction],
  hooks: () => {
    registerIntegrityHooks();
  },
  menus: [{ label: label('証憑', 'Attachments'), entity: 'attachment', order: 90 }],
});
