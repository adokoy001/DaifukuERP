// UI kit: Tabs — WAI-ARIA tabs with a roving tabindex and automatic activation (Arrow keys, Home, End). A tab list
// wider than its box scrolls inside itself and keeps the selected tab in view (also when the selection comes from a URL).
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx.ts';

export interface TabItem {
  id: string;
  label: ReactNode;
  disabled?: boolean;
}

export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const tabPanelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

/** Index of the tab a key moves to (skipping disabled tabs, wrapping), or undefined for any other key. */
export function nextTabIndex(items: readonly TabItem[], current: number, key: string): number | undefined {
  const enabled = items.flatMap((item, index) => (item.disabled ? [] : [index]));
  if (enabled.length === 0) return undefined;
  if (key === 'Home') return enabled[0];
  if (key === 'End') return enabled[enabled.length - 1];
  const step = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
  if (step === 0) return undefined;
  const size = items.length;
  for (let n = 1; n <= size; n++) {
    const index = (((current + step * n) % size) + size) % size;
    if (!items[index]?.disabled) return index;
  }
  return undefined;
}

export interface TabsProps {
  items: readonly TabItem[];
  selected: string;
  onSelect: (id: string) => void;
  /** Accessible name of the tab list. */
  label: string;
  /** Prefix for tab / panel ids; pair each tab with a <TabPanel idPrefix={...} id={...}>. */
  idPrefix: string;
  className?: string;
}

/** How far to scroll a horizontal list so `tab` is inside `list` (0 when it already is). Rects in viewport pixels. */
export function scrollToShow(list: { left: number; right: number }, tab: { left: number; right: number }): number {
  if (tab.left < list.left) return tab.left - list.left;
  if (tab.right > list.right) return Math.min(tab.right - list.right, tab.left - list.left);
  return 0;
}

export function Tabs({ items, selected, onSelect, label, idPrefix, className }: TabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const selectedIndex = items.findIndex((item) => item.id === selected && !item.disabled);
  const focusable = selectedIndex >= 0 ? selectedIndex : items.findIndex((item) => !item.disabled);
  useEffect(() => {
    // Only the list scrolls (never the page), so a selection from the URL is visible on a narrow screen.
    const box = list.current;
    const tab = refs.current[selectedIndex];
    if (!box || !tab || box.scrollWidth <= box.clientWidth) return;
    const delta = scrollToShow(box.getBoundingClientRect(), tab.getBoundingClientRect());
    if (delta !== 0) box.scrollLeft += delta;
  }, [selectedIndex]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextTabIndex(items, index, event.key);
    const target = next === undefined ? undefined : items[next];
    if (next === undefined || !target) return;
    event.preventDefault();
    onSelect(target.id);
    refs.current[next]?.focus();
  };
  return (
    <div ref={list} role="tablist" aria-label={label} className={cx('ui-tabs', className)}>
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="button"
          role="tab"
          id={tabId(idPrefix, item.id)}
          aria-selected={item.id === selected}
          aria-controls={tabPanelId(idPrefix, item.id)}
          tabIndex={index === focusable ? 0 : -1}
          disabled={item.disabled}
          className="ui-tab"
          onClick={() => onSelect(item.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export interface TabPanelProps {
  idPrefix: string;
  id: string;
  selected: boolean;
  children?: ReactNode;
  className?: string;
}

/** The panel of one tab; hidden (and not rendered) while its tab is not selected. */
export function TabPanel({ idPrefix, id, selected, children, className }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={tabPanelId(idPrefix, id)}
      aria-labelledby={tabId(idPrefix, id)}
      hidden={!selected}
      tabIndex={0}
      className={cx('ui-tab-panel', className)}
    >
      {selected ? children : null}
    </div>
  );
}
