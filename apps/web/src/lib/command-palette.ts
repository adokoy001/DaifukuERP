// navigation-assist AC-2: the command palette's candidates. Screens come from the existing catalog search
// (searchNavigation, permission-filtered metadata), then recent records. Pure; rendering is command-palette.tsx.
import type { Locale } from '../api/types.ts';
import { searchNavigation } from './navigation.ts';
import type { NavigationCatalog, NavigationEntry } from './navigation-types.ts';
import { searchRecentRecords, type RecentRecordView } from './recent-records.ts';

export const PALETTE_SCREEN_LIMIT = 20;
export const PALETTE_RECORD_LIMIT = 10;
/** Featured screens offered before anything is typed. */
export const PALETTE_START_SCREENS = 8;

export type PaletteOption =
  { kind: 'screen'; key: string; entry: NavigationEntry } | { kind: 'record'; key: string; record: RecentRecordView };
export interface PaletteGroup {
  id: 'favorites' | 'screens' | 'records';
  options: PaletteOption[];
}
export interface Palette {
  groups: PaletteGroup[];
  /** Every option in display order; arrow keys move through this list. */
  options: PaletteOption[];
  /** Matching screens beyond the limit, reachable through the full screen search. */
  moreScreens: number;
}

const screen = (entry: NavigationEntry): PaletteOption => ({ kind: 'screen', key: `screen:${entry.href}`, entry });
const record = (item: RecentRecordView): PaletteOption => ({
  kind: 'record',
  key: `record:${item.entity}/${item.id}`,
  record: item,
});

/**
 * With a query: matching screens, then matching recent records. Without one: favourites, recent records and the
 * first featured screens, so the palette is useful before typing.
 */
export function buildPalette(input: {
  catalog: NavigationCatalog;
  query: string;
  locale: Locale;
  favorites: readonly NavigationEntry[];
  records: readonly RecentRecordView[];
}): Palette {
  const { catalog, query, locale, favorites, records } = input;
  let groups: PaletteGroup[];
  let moreScreens = 0;
  if (query.trim()) {
    const screens = searchNavigation(catalog, query, locale);
    moreScreens = Math.max(0, screens.length - PALETTE_SCREEN_LIMIT);
    groups = [
      { id: 'screens', options: screens.slice(0, PALETTE_SCREEN_LIMIT).map(screen) },
      {
        id: 'records',
        options: searchRecentRecords(records, query, locale).slice(0, PALETTE_RECORD_LIMIT).map(record),
      },
    ];
  } else {
    const favorite = new Set(favorites.map((entry) => entry.href));
    groups = [
      { id: 'favorites', options: favorites.map(screen) },
      { id: 'records', options: records.slice(0, PALETTE_RECORD_LIMIT).map(record) },
      {
        id: 'screens',
        options: catalog.entries
          .filter((entry) => entry.featured && !favorite.has(entry.href))
          .slice(0, PALETTE_START_SCREENS)
          .map(screen),
      },
    ];
  }
  groups = groups.filter((group) => group.options.length > 0);
  return { groups, options: groups.flatMap((group) => group.options), moreScreens };
}

/** Arrow-key movement through the options, wrapping at both ends; -1 when there is nothing to select. */
export function movePaletteSelection(current: number, count: number, step: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return step > 0 ? 0 : count - 1;
  return (current + step + count) % count;
}
