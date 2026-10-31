// ui-kit AC-10: <html lang> follows the displayed language.
import { describe, expect, it } from 'vitest';
import { syncDocumentLang } from './i18n.tsx';

const fakeDocument = (lang: string) => ({ documentElement: { lang } }) as unknown as Pick<Document, 'documentElement'>;

describe('ui-kit AC-10: syncDocumentLang', () => {
  it('AC-10: sets the document language to the locale', () => {
    const doc = fakeDocument('ja');
    syncDocumentLang('en', doc);
    expect(doc.documentElement.lang).toBe('en');
    syncDocumentLang('ja', doc);
    expect(doc.documentElement.lang).toBe('ja');
  });

  it('AC-10: is a no-op without a document (server rendering, workers)', () => {
    expect(() => syncDocumentLang('en', undefined)).not.toThrow();
  });
});
