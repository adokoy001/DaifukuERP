export type Locale = 'ja' | 'en';

/** Every human-facing string carries both languages (docs/conventions/code-style.md). */
export interface Label {
  ja: string;
  en: string;
}

export function label(ja: string, en: string): Label {
  return { ja, en };
}

export function t(l: Label | undefined, locale: Locale, fallback = ''): string {
  if (!l) return fallback;
  return l[locale] ?? l.en ?? fallback;
}
