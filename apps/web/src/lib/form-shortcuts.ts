// form-ergonomics AC-5/AC-6/AC-10: keyboard decisions of the generic form and its line grids. Pure (no DOM), so the
// rules are unit-tested; components/record-form.tsx and components/line-grid.tsx act on the result.

/** The parts of a KeyboardEvent the decisions read. */
export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
  /** 229 while an IME handles the key (Safari reports it with isComposing false). */
  keyCode?: number;
}

/**
 * IME composition: the native `isComposing`, or keyCode 229. React's synthetic KeyboardEvent has no `isComposing`, so a
 * React handler passes `fromReactKey(event)` (or `event.nativeEvent`) instead of the synthetic event.
 */
export function isComposingKey(event: KeyLike): boolean {
  return event.isComposing === true || event.keyCode === 229;
}

/** The KeyLike of a React keyboard event, with the composition state read from the native event. */
export function fromReactKey(event: {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  keyCode: number;
  nativeEvent: { isComposing: boolean };
}): KeyLike {
  return {
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    isComposing: event.nativeEvent.isComposing,
    keyCode: event.keyCode,
  };
}

/** macOS and iOS use ⌘ as the primary modifier; everything else uses Ctrl (same rule as the Ctrl/⌘+K palette). */
export const IS_MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');

/** `Control+S` / `Meta+S` for aria-keyshortcuts and the shortcut list. */
export function shortcutLabel(key: 'S' | 'Enter', mac: boolean): { aria: string; text: string } {
  return mac
    ? { aria: `Meta+${key}`, text: `⌘${key === 'Enter' ? '↩' : key}` }
    : { aria: `Control+${key}`, text: `Ctrl+${key}` };
}

/** AC-6/AC-10: Alt+↑ / Alt+↓ in the platform notation (macOS names the key Option, ⌥). */
export function altArrowLabel(arrow: '↑' | '↓', mac: boolean): string {
  return mac ? `⌥${arrow}` : `Alt+${arrow}`;
}

export type FormShortcut = 'save' | 'advance';

/**
 * AC-5: Ctrl+S (⌘+S) saves, Ctrl+Enter (⌘+Enter) advances. Only the platform's own modifier counts (Ctrl+S on macOS
 * is not ours), and never during IME composition or with Alt/Shift held. The S is the letter the layout types; the
 * physical key (`code`) counts only when the layout types no Latin letter there (Cyrillic, Greek…), so Ctrl+O on
 * Dvorak (physical KeyS) stays the browser's.
 */
export function formShortcut(event: KeyLike, mac: boolean): FormShortcut | undefined {
  const primary = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!primary || isComposingKey(event) || event.altKey || event.shiftKey) return undefined;
  if (event.key === 'Enter') return 'advance';
  const latin = /^[a-z]$/i.test(event.key);
  if (latin ? event.key.toLowerCase() === 's' : event.code === 'KeyS') return 'save';
  return undefined;
}

export interface AdvanceContext {
  /** No record yet (/new). */
  isNew: boolean;
  /** Unsaved changes. */
  dirty: boolean;
  /** The save button would act (write permission, something editable, not saving, no conflict). */
  canSave: boolean;
  /** A saved draft document the user may submit, with nothing blocking the submit button. */
  canSubmit: boolean;
}

/**
 * AC-5: what Ctrl+Enter does. Unsaved work is saved first (the existing rule: no document action while there are
 * unsaved changes); a clean draft document opens the submit confirmation; anything else saves as before.
 */
export function advanceAction(ctx: AdvanceContext): 'save' | 'submit' | undefined {
  if (!ctx.isNew && !ctx.dirty && ctx.canSubmit) return 'submit';
  return ctx.canSave ? 'save' : undefined;
}

export type GridKey = 'next' | 'move-up' | 'move-down';

/** AC-6: Enter (no modifier) moves to the next cell; Alt+↑ / Alt+↓ move the row. */
export function gridKey(event: KeyLike): GridKey | undefined {
  if (isComposingKey(event)) return undefined;
  if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) return 'next';
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    if (event.key === 'ArrowUp') return 'move-up';
    if (event.key === 'ArrowDown') return 'move-down';
  }
  return undefined;
}

export type CellTarget = { row: number; field: string } | 'add';

/**
 * AC-6: where Enter goes from `field` of row `row`: the next editable cell of the row, else the first editable cell of
 * the next row, else (last cell of the last row) a new row. Undefined when nothing in the grid is editable.
 */
export function nextCell(
  editable: readonly string[],
  rowCount: number,
  row: number,
  field: string,
): CellTarget | undefined {
  const first = editable[0];
  if (first === undefined || row < 0 || row >= rowCount) return undefined;
  const at = editable.indexOf(field);
  const next = at === -1 ? undefined : editable[at + 1];
  if (next !== undefined) return { row, field: next };
  return row + 1 < rowCount ? { row: row + 1, field: first } : 'add';
}

/** AC-6: the index a row moves to with Alt+↑ / Alt+↓, or undefined at the edge. */
export function movedIndex(index: number, count: number, key: 'move-up' | 'move-down'): number | undefined {
  const to = key === 'move-up' ? index - 1 : index + 1;
  return to >= 0 && to < count && index >= 0 && index < count ? to : undefined;
}
