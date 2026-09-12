// Locale context: every label in the app is a `{ ja, en }` pair rendered through `tr` (docs/conventions/code-style.md).
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Label, Locale } from './api/types.ts';

const LOCALE_KEY = 'daifuku.locale';

export function tr(label: Label | undefined, locale: Locale, fallback = ''): string {
  if (!label) return fallback;
  return label[locale] || label.en || fallback;
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** Translate a label in the current locale. */
  t: (label: Label | undefined, fallback?: string) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function readStoredLocale(): Locale {
  try {
    return globalThis.localStorage?.getItem(LOCALE_KEY) === 'en' ? 'en' : 'ja';
  } catch {
    return 'ja';
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      globalThis.localStorage?.setItem(LOCALE_KEY, l);
    } catch {
      // storage unavailable (private mode): the choice simply does not persist
    }
    document.documentElement.lang = l;
  }, []);
  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale, t: (label, fallback) => tr(label, locale, fallback) }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new TypeError('useLocale must be used inside <LocaleProvider>');
  return ctx;
}
