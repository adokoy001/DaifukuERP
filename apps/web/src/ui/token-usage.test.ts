// ui-kit AC-2/AC-3/AC-15: converted screens and the kit use semantic tokens only, and the breakpoints stay at
// 480 / 768 / 1024 / 1280 px. A source scan keeps it that way when the files are edited later.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const read = (path: string) => readFileSync(SRC + path, 'utf8');

/** Generic screens moved onto the kit (docs/specs/ui-kit.md AC-3). Add a file here when you convert it. */
const CONVERTED = [
  'pages/entity-list-page.tsx',
  'pages/entity-form-page.tsx',
  'pages/settings-page.tsx',
  'pages/action-page.tsx',
  'pages/report-page.tsx',
  'pages/status-views.tsx',
  'components/data-table.tsx',
  'components/list-empty-state.tsx',
  'components/toast.tsx',
  'components/docstatus-badge.tsx',
  'components/action-confirm.tsx',
  'components/setting-card.tsx',
  'components/setting-code-field.tsx',
];
const KIT = readdirSync(SRC + 'ui')
  .filter((name) => /\.(tsx?|css)$/.test(name) && !name.endsWith('.test.ts'))
  .map((name) => 'ui/' + name);

const HEX = /(?<![\w&/-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
const PALETTE =
  /\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide|shadow|caret|decoration|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?\b/g;
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/g;

describe('ui-kit AC-3: converted screens use the kit and tokens, not raw colours', () => {
  it.each([...CONVERTED, ...KIT])('AC-3: %s has no hex colour literal', (path) => {
    expect(read(path).match(HEX) ?? []).toEqual([]);
  });

  it.each([...CONVERTED, ...KIT])('AC-3: %s has no raw Tailwind palette colour utility', (path) => {
    expect(read(path).match(PALETTE) ?? []).toEqual([]);
  });

  it('AC-3: kit CSS takes every colour from a token', () => {
    expect(read('ui/ui.css').match(COLOR_FUNCTION) ?? []).toEqual([]);
  });

  it('AC-3: the scan itself detects the patterns it guards against', () => {
    expect('color: #F6f7fb; border: #fff'.match(HEX)).toEqual(['#F6f7fb', '#fff']);
    expect('id="#f-name" href="/#top"'.match(HEX)).toBeNull();
    expect('className="text-neutral-500 bg-white border-red-200"'.match(PALETTE)).toEqual([
      'text-neutral-500',
      'bg-white',
      'border-red-200',
    ]);
    expect('className="text-text-muted bg-surface border-border text-danger-text"'.match(PALETTE)).toBeNull();
  });
});

describe('ui-kit AC-2: semantic tokens', () => {
  const styles = read('styles.css');
  const root = /\n:root \{([\s\S]*?)\n\}/.exec(styles)?.[1] ?? '';
  const themeInline = /@theme inline \{([\s\S]*?)\n\}/.exec(styles)?.[1] ?? '';

  it.each([
    'surface',
    'surface-muted',
    'border',
    'text',
    'text-muted',
    'accent',
    'accent-strong',
    'danger',
    'success',
    'warning',
  ])('AC-2: --%s is defined on :root and usable as a Tailwind colour', (token) => {
    expect(root).toMatch(new RegExp(`\\n\\s*--${token}: [^;]+;`));
    expect(themeInline).toContain(`--color-${token}: var(--${token});`);
  });

  it('AC-2: every colour token on :root is also a Tailwind colour of the same name', () => {
    const colours = [...root.matchAll(/\n\s*--([\w-]+): (#|oklch\(|rgb)/g)].map((m) => m[1]);
    expect(colours.length).toBeGreaterThan(40);
    const missing = colours.filter((name) => !themeInline.includes(`--color-${name}: var(--${name});`));
    expect(missing).toEqual([]);
    const exposed = [...themeInline.matchAll(/--color-([\w-]+): var\(--([\w-]+)\);/g)];
    expect(exposed.filter((m) => m[1] !== m[2] || !colours.includes(m[1] ?? ''))).toEqual([]);
  });

  it('AC-2: every var() used by the kit CSS is a defined token or a sanctioned Tailwind theme variable', () => {
    const defined = new Set([...root.matchAll(/--([\w-]+):/g)].map((m) => m[1]));
    // The app's rem scale (html is 14px): kit sizes follow the utility classes they replaced.
    const theme = ['font-mono', 'spacing', 'text-xs', 'text-xs--line-height', 'text-sm', 'text-sm--line-height'];
    for (const name of [...theme, 'radius-sm']) defined.add(name);
    const used = [...read('ui/ui.css').matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !defined.has(name))).toEqual([]);
  });

  it('AC-2: low-contrast tokens are not used for text that carries information', () => {
    // --text-subtle (3.0:1 on canvas) and --text-faint (1.5:1) are for icons and decoration only.
    for (const path of [...CONVERTED, ...KIT.filter((name) => name.endsWith('.tsx'))])
      expect(read(path).match(/\btext-text-(?:subtle|faint)\b/g) ?? []).toEqual([]);
    const css = read('ui/ui.css');
    expect(css).not.toContain('var(--text-subtle)');
    const faint = [...css.matchAll(/\n {2}([^{}\n]+) \{[^}]*color: var\(--text-faint\)/g)].map((m) => m[1]);
    expect(faint).toEqual(['.ui-empty-icon', '.ui-sort-icon']);
  });

  it('AC-2: base controls in styles.css read the tokens', () => {
    expect(styles).toMatch(/\.btn-primary \{\s*background: var\(--accent\);/);
    expect(styles).toMatch(/\.btn-danger \{\s*background: var\(--danger\);/);
    expect(styles).toMatch(/body \{\s*margin: 0;\s*background: var\(--canvas\);\s*color: var\(--text\);/);
  });

  it('AC-2: the unlayered generic table rules (which win over the kit layer) read the same tokens as the kit', () => {
    const rule = (selector: string) =>
      new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(styles)?.[1] ?? '';
    const th = rule('.page-content th');
    expect(th).toContain('background: var(--surface-muted);');
    expect(th).toContain('color: var(--text-muted);');
    expect(th).toContain('border-bottom: 1px solid var(--border);');
    expect(th.match(HEX) ?? []).toEqual([]);
    expect(rule('.page-content tbody tr:nth-child(even)')).toContain('background: var(--row-stripe);');
    expect(rule('.page-content tbody tr:hover')).toContain('background: var(--row-hover);');
    const kitTh = /\.ui-table th \{([^}]*)\}/.exec(read('ui/ui.css'))?.[1] ?? '';
    expect(kitTh).toContain('color: var(--text-muted);');
    expect(kitTh).toContain('background: var(--surface-muted);');
  });
});

describe('ui-kit AC-11: Tabs focus ring', () => {
  it('AC-11: the focus outline of a tab is drawn inside it, so the scrolling tab list does not clip it', () => {
    expect(read('ui/ui.css')).toMatch(/\.ui-tab:focus-visible \{\s*outline-offset: -3px;/);
  });
});

describe('ui-kit AC-15: breakpoints', () => {
  it('AC-15: kit CSS only uses the 480 / 768 / 1024 / 1280 px breakpoints', () => {
    const widths = [...read('ui/ui.css').matchAll(/@media[^{]*\((?:max|min)-width:\s*(\d+)px\)/g)].map((m) =>
      Number(m[1]),
    );
    expect(widths.length).toBeGreaterThan(0);
    for (const width of widths) expect([479, 480, 767, 768, 1023, 1024, 1279, 1280]).toContain(width);
  });

  it('AC-15: Tailwind responsive variants are sm 480, md 768, lg 1024, xl 1280 and nothing wider', () => {
    const styles = read('styles.css');
    expect(styles).toContain('--breakpoint-sm: 30rem;');
    expect(styles).toContain('--breakpoint-md: 48rem;');
    expect(styles).toContain('--breakpoint-lg: 64rem;');
    expect(styles).toContain('--breakpoint-xl: 80rem;');
    expect(styles).toContain('--breakpoint-2xl: initial;');
  });
});
