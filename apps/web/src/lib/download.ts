// Browser-side "save this blob as a file" (CSV export, attachment download) and "show this HTML in that tab" (print view).
// Authenticated endpoints cannot be plain links (the Bearer token lives in sessionStorage), so bytes are fetched first and
// handed to the browser as an object URL.

/** Long enough for a print dialog; a reload of the tab after this shows a blank page (the app tab must stay open anyway). */
const HTML_URL_TTL_MS = 10 * 60_000;

/** Navigates an already-opened window (opened synchronously in the click, so pop-up blockers allow it) to rendered HTML. */
export function showHtmlIn(win: Window, html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  win.opener = null;
  win.location.replace(url);
  globalThis.setTimeout(() => URL.revokeObjectURL(url), HTML_URL_TTL_MS);
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Parses `Content-Disposition` (RFC 5987 `filename*=UTF-8''...` preferred, then `filename="..."`). */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      return fallback;
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(header);
  return plain?.[1]?.trim() || fallback;
}
