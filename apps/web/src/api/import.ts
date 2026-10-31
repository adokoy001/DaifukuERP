// csv-import (docs/specs/csv-import.md): POST /api/:entity/import and the header template download.
import type { Locale } from './types.ts';
import { download, request, type Downloaded } from './client.ts';
import type { ImportRequest, ImportResult } from '../lib/import-map.ts';

export function runImport(entity: string, body: ImportRequest): Promise<ImportResult> {
  return request<ImportResult>(`/api/${entity}/import`, { method: 'POST', body, cache: 'no-store' });
}

export function downloadImportTemplate(entity: string, locale: Locale): Promise<Downloaded> {
  return download(`/api/${entity}/import-template.csv?lang=${locale}`);
}
