// e2e-a11y (docs/specs/e2e-a11y.md): the screen matrix and the pure rules that decide which axe violations fail a run.
// No Playwright import here, so the web unit project can test the rules and the checked-in exception file
// (apps/web/src/a11y-policy.test.ts) without a browser.

export const A11Y_LOCALES = ['ja', 'en'] as const;
export const A11Y_WIDTHS = [1280, 390] as const;
export type A11yLocale = (typeof A11Y_LOCALES)[number];
export type A11yWidth = (typeof A11Y_WIDTHS)[number];

/** WCAG 2.1 level A and AA success criteria as axe rule tags (AC-1). Best-practice rules are not part of the gate. */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;
/** Impacts that fail the run (AC-2). `moderate` and `minor` are printed but never fail (out of scope). */
export const FAILING_IMPACTS: readonly string[] = ['serious', 'critical'];

export interface A11yScreen {
  /** Stable id used in test names and in `a11y-exceptions.json`. */
  id: string;
  path: string;
  /** `false` only for screens shown without a session (the login screen). */
  auth: boolean;
}

/** The 8 screens of AC-1, in the order of the spec. */
export const A11Y_SCREENS: readonly A11yScreen[] = [
  { id: 'login', path: '/login', auth: false },
  { id: 'home', path: '/', auth: true },
  { id: 'partner-list', path: '/e/partner', auth: true },
  { id: 'sales-invoice-new', path: '/e/sales_invoice/new', auth: true },
  { id: 'settings', path: '/settings', auth: true },
  { id: 'me', path: '/me', auth: true },
  { id: 'workforce', path: '/workforce', auth: true },
  { id: 'analytics', path: '/analytics', auth: true },
];

export interface A11yRun {
  screen: string;
  locale: A11yLocale;
  width: A11yWidth;
}

/** AC-5: the Japanese desktop case of every screen is part of `pnpm e2e:smoke`. */
export function isSmokeRun(run: Pick<A11yRun, 'locale' | 'width'>): boolean {
  return run.locale === 'ja' && run.width === 1280;
}

export function a11yTitle(run: A11yRun): string {
  return `a11y AC-1/AC-2/AC-3: ${run.screen} (${run.locale}, ${run.width}px)${isSmokeRun(run) ? ' @smoke' : ''}`;
}

/** One test per screen x locale x width (32 runs). */
export interface A11yCase extends A11yRun {
  path: string;
  auth: boolean;
}

export function a11yRuns(): A11yCase[] {
  return A11Y_SCREENS.flatMap(({ id, path, auth }) =>
    A11Y_LOCALES.flatMap((locale) => A11Y_WIDTHS.map((width) => ({ screen: id, locale, width, path, auth }))),
  );
}

/** One registered exception (AC-2/AC-3). `locales` / `widths` narrow it; omitted means every condition. */
export interface A11yException {
  rule: string;
  screen: string;
  /** The axe node target, frames joined with ` >>> ` (see `targetOf`). Matched exactly. */
  target: string;
  reason: string;
  /** Where the fix is tracked (spec, plan item) or a deadline (YYYY-MM-DD). */
  followUp: string;
  locales?: A11yLocale[];
  widths?: A11yWidth[];
}

const KEYS = new Set(['rule', 'screen', 'target', 'reason', 'followUp', 'locales', 'widths']);
const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0;

/** AC-3: every exception names a known screen and condition, a target, a reason and a follow-up. */
export function parseExceptions(raw: unknown): { exceptions: A11yException[]; errors: string[] } {
  const errors: string[] = [];
  const file = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const list = file && Array.isArray(file.exceptions) ? (file.exceptions as unknown[]) : null;
  if (!file || !list) return { exceptions: [], errors: ['the file must be an object with an "exceptions" array'] };
  for (const key of Object.keys(file))
    if (key !== 'exceptions' && key !== 'about') errors.push(`${key} is not a known top-level field`);
  const screens = new Set(A11Y_SCREENS.map((screen) => screen.id));
  const seen = new Set<string>();
  const exceptions: A11yException[] = [];
  list.forEach((item, index) => {
    const at = `exceptions[${index}]`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const entry = item as Record<string, unknown>;
    const before = errors.length;
    for (const key of Object.keys(entry)) if (!KEYS.has(key)) errors.push(`${at}.${key} is not a known field`);
    for (const key of ['rule', 'screen', 'target', 'reason', 'followUp'])
      if (!text(entry[key])) errors.push(`${at}.${key} is required (non-empty string)`);
    if (text(entry.screen) && !screens.has(entry.screen as string))
      errors.push(`${at}.screen "${String(entry.screen)}" is not one of ${[...screens].join(', ')}`);
    const subset = (key: 'locales' | 'widths', allowed: readonly unknown[]) => {
      const value = entry[key];
      if (value === undefined) return;
      if (!Array.isArray(value) || value.length === 0 || value.some((part) => !allowed.includes(part)))
        errors.push(`${at}.${key} must be a non-empty list of ${allowed.join(' / ')}`);
    };
    subset('locales', A11Y_LOCALES);
    subset('widths', A11Y_WIDTHS);
    if (errors.length > before) return;
    const exception = entry as unknown as A11yException;
    const key = [exception.rule, exception.screen, exception.target].join('\u0000');
    if (seen.has(key)) {
      errors.push(`${at} duplicates rule/screen/target ${exception.rule} ${exception.target}`);
      return;
    }
    seen.add(key);
    exceptions.push(exception);
  });
  return { exceptions, errors };
}

/** The subset of axe's result shape the policy reads. */
export interface AxeNode {
  target: unknown[];
  html?: string;
  failureSummary?: string;
}
export interface AxeViolation {
  id: string;
  impact?: string | null;
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
}

/** axe's node target: one selector per frame (a nested array inside shadow DOM). */
export function targetOf(node: Pick<AxeNode, 'target'>): string {
  return node.target.map((part) => (Array.isArray(part) ? part.join(' > ') : String(part))).join(' >>> ');
}

export interface A11yFinding {
  rule: string;
  impact: string;
  help: string;
  helpUrl: string;
  target: string;
  html: string;
  summary: string;
}

export interface A11yJudgement {
  /** Serious / critical findings without an exception: the run fails (AC-2). */
  failures: A11yFinding[];
  /** Findings covered by an exception. */
  waived: A11yFinding[];
  /** Exceptions that apply to this run but matched no finding: the run fails (AC-3). */
  stale: A11yException[];
  /** Moderate / minor findings: printed, never failing. */
  advisory: A11yFinding[];
}

export function appliesTo(exception: A11yException, run: A11yRun): boolean {
  return (
    exception.screen === run.screen &&
    (exception.locales?.includes(run.locale) ?? true) &&
    (exception.widths?.includes(run.width) ?? true)
  );
}

export function judge(
  violations: readonly AxeViolation[],
  exceptions: readonly A11yException[],
  run: A11yRun,
): A11yJudgement {
  const applicable = exceptions.filter((exception) => appliesTo(exception, run));
  const used = new Set<A11yException>();
  const result: A11yJudgement = { failures: [], waived: [], stale: [], advisory: [] };
  for (const violation of violations) {
    // axe always sets the impact of a violation; a missing one is treated as failing rather than silently advisory.
    const impact = violation.impact ?? 'unknown';
    const failing = impact === 'unknown' || FAILING_IMPACTS.includes(impact);
    for (const node of violation.nodes) {
      const finding: A11yFinding = {
        rule: violation.id,
        impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        target: targetOf(node),
        html: node.html ?? '',
        summary: node.failureSummary ?? '',
      };
      if (!failing) {
        result.advisory.push(finding);
        continue;
      }
      const exception = applicable.find((item) => item.rule === finding.rule && item.target === finding.target);
      if (exception) {
        used.add(exception);
        result.waived.push(finding);
      } else result.failures.push(finding);
    }
  }
  result.stale = applicable.filter((exception) => !used.has(exception));
  return result;
}

/** A readable report: rule, impact, target and description of each finding, then stale and waived exceptions. */
export function formatJudgement(run: A11yRun, judgement: A11yJudgement): string {
  const lines: string[] = [`axe ${run.screen} (${run.locale}, ${run.width}px)`];
  const finding = (item: A11yFinding) =>
    `  - [${item.impact}] ${item.rule}: ${item.help}\n    target: ${item.target}\n    html: ${item.html.slice(0, 240)}` +
    (item.summary ? `\n    ${item.summary.replaceAll('\n', '\n    ')}` : '') +
    `\n    ${item.helpUrl}`;
  if (judgement.failures.length) {
    lines.push(`serious/critical violations without an exception (${judgement.failures.length}):`);
    lines.push(...judgement.failures.map(finding));
  }
  if (judgement.stale.length) {
    lines.push(`exceptions that matched nothing in this run (remove or narrow them) (${judgement.stale.length}):`);
    lines.push(...judgement.stale.map((item) => `  - ${item.rule} ${item.screen} ${item.target} (${item.reason})`));
  }
  if (judgement.waived.length) lines.push(`waived by a11y-exceptions.json: ${judgement.waived.length}`);
  if (judgement.advisory.length) {
    lines.push(`moderate/minor (reported, not failing) (${judgement.advisory.length}):`);
    lines.push(...judgement.advisory.map(finding));
  }
  return lines.join('\n');
}
