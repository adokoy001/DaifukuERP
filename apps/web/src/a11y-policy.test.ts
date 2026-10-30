// e2e-a11y (docs/specs/e2e-a11y.md): the screen matrix and the exception rules that apps/web/e2e/a11y.spec.ts applies
// to axe results, and the checked-in exception file. The browser run itself is the Playwright spec.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  A11Y_SCREENS,
  WCAG_TAGS,
  a11yRuns,
  a11yTitle,
  formatJudgement,
  isSmokeRun,
  judge,
  parseExceptions,
  targetOf,
  type A11yException,
  type A11yRun,
  type AxeViolation,
} from '../e2e/a11y-policy.ts';

const RUN: A11yRun = { screen: 'home', locale: 'ja', width: 1280 };
const violation = (id: string, impact: string | null, ...targets: string[]): AxeViolation => ({
  id,
  impact,
  help: `${id} help`,
  helpUrl: `https://dequeuniversity.com/rules/axe/4.13/${id}`,
  nodes: targets.map((target) => ({
    target: [target],
    html: `<span class="${target}">x</span>`,
    failureSummary: 'Fix',
  })),
});
const exception = (overrides: Partial<A11yException> = {}): A11yException => ({
  rule: 'color-contrast',
  screen: 'home',
  target: '.eyebrow',
  reason: 'Brand colour under review',
  followUp: 'docs/specs/ui-kit.md',
  ...overrides,
});

describe('e2e-a11y AC-1: the screen matrix', () => {
  it('AC-1: checks the 8 screens of the spec in ja/en at 1280px and 390px (32 runs, unique names)', () => {
    expect(A11Y_SCREENS.map((screen) => screen.path)).toEqual([
      '/login',
      '/',
      '/e/partner',
      '/e/sales_invoice/new',
      '/settings',
      '/me',
      '/workforce',
      '/analytics',
    ]);
    expect(A11Y_SCREENS.filter((screen) => !screen.auth).map((screen) => screen.id)).toEqual(['login']);
    const runs = a11yRuns();
    expect(runs).toHaveLength(32);
    expect(new Set(runs.map(a11yTitle)).size).toBe(32);
    for (const screen of A11Y_SCREENS)
      expect(runs.filter((run) => run.screen === screen.id).map((run) => `${run.locale}/${run.width}`)).toEqual([
        'ja/1280',
        'ja/390',
        'en/1280',
        'en/390',
      ]);
  });

  it('AC-1: axe runs the WCAG 2.1 A and AA rule tags only', () => {
    expect([...WCAG_TAGS]).toEqual(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  });
});

describe('e2e-a11y AC-5: smoke cases', () => {
  it('AC-5: exactly the Japanese 1280px case of each of the 8 screens ends with " @smoke"', () => {
    const titles = a11yRuns().map(a11yTitle);
    const smoke = titles.filter((title) => title.includes('@smoke'));
    expect(smoke).toHaveLength(8);
    expect(smoke.every((title) => title.endsWith(' (ja, 1280px) @smoke'))).toBe(true);
    expect(
      new Set(
        a11yRuns()
          .filter(isSmokeRun)
          .map((run) => run.screen),
      ),
    ).toEqual(new Set(A11Y_SCREENS.map((screen) => screen.id)));
  });
});

describe('e2e-a11y AC-2: which findings fail a run', () => {
  it('AC-2: a serious or critical finding without an exception fails, with rule, target and description', () => {
    const result = judge(
      [violation('color-contrast', 'serious', '.eyebrow'), violation('button-name', 'critical', '#go')],
      [],
      RUN,
    );
    expect(result.failures.map((item) => `${item.impact} ${item.rule} ${item.target}`)).toEqual([
      'serious color-contrast .eyebrow',
      'critical button-name #go',
    ]);
    const report = formatJudgement(RUN, result);
    expect(report).toContain('[serious] color-contrast: color-contrast help');
    expect(report).toContain('target: .eyebrow');
    expect(report).toContain('https://dequeuniversity.com/rules/axe/4.13/button-name');
  });

  it('AC-2: an exception waives only the same rule, screen and target (each node is judged separately)', () => {
    const result = judge([violation('color-contrast', 'serious', '.eyebrow', '.other')], [exception()], RUN);
    expect(result.waived.map((item) => item.target)).toEqual(['.eyebrow']);
    expect(result.failures.map((item) => item.target)).toEqual(['.other']);
    expect(judge([violation('link-name', 'serious', '.eyebrow')], [exception()], RUN).failures).toHaveLength(1);
    expect(
      judge([violation('color-contrast', 'serious', '.eyebrow')], [exception()], { ...RUN, screen: 'me' }).failures,
    ).toHaveLength(1);
  });

  it('AC-2: locales and widths narrow an exception to the listed conditions', () => {
    const narrow = exception({ locales: ['en'], widths: [390] });
    const found = [violation('color-contrast', 'serious', '.eyebrow')];
    expect(judge(found, [narrow], { ...RUN, locale: 'en', width: 390 }).failures).toHaveLength(0);
    expect(judge(found, [narrow], { ...RUN, locale: 'ja', width: 390 }).failures).toHaveLength(1);
    expect(judge(found, [narrow], { ...RUN, locale: 'en', width: 1280 }).failures).toHaveLength(1);
  });

  it('AC-2: moderate and minor findings are reported but never fail; a missing impact fails', () => {
    const result = judge([violation('region', 'moderate', 'main'), violation('x', 'minor', 'p')], [], RUN);
    expect(result.failures).toHaveLength(0);
    expect(result.advisory.map((item) => item.rule)).toEqual(['region', 'x']);
    expect(formatJudgement(RUN, result)).toContain('moderate/minor (reported, not failing) (2)');
    expect(judge([violation('y', null, 'p')], [], RUN).failures).toHaveLength(1);
  });

  it('AC-2: the target joins frames and shadow-DOM paths', () => {
    expect(targetOf({ target: ['#frame', '.inner'] })).toBe('#frame >>> .inner');
    expect(targetOf({ target: [['my-widget', 'button']] })).toBe('my-widget > button');
  });
});

describe('e2e-a11y AC-3: exceptions need reasons and must stay in use', () => {
  it('AC-3: an exception that applies to the run but matches nothing is stale and reported', () => {
    const stale = exception({ target: '.gone' });
    const result = judge([violation('color-contrast', 'serious', '.eyebrow')], [exception(), stale], RUN);
    expect(result.stale).toEqual([stale]);
    expect(formatJudgement(RUN, result)).toContain('exceptions that matched nothing in this run');
    // Exceptions for other screens or conditions are judged by their own runs, so a filtered run (`@smoke`) is exact.
    expect(judge([], [exception({ screen: 'me' }), exception({ widths: [390] })], RUN).stale).toEqual([]);
  });

  it('AC-3: rejects entries without a reason or follow-up, unknown screens, conditions and fields, and duplicates', () => {
    const { errors } = parseExceptions({
      exceptions: [
        { ...exception(), reason: ' ' },
        { rule: 'color-contrast', screen: 'home', target: '.a', reason: 'r' },
        { ...exception(), screen: 'reports' },
        { ...exception(), locales: ['fr'] },
        { ...exception(), widths: [] },
        { ...exception(), until: '2027-01-01' },
        exception(),
        exception(),
        'color-contrast',
      ],
      extra: true,
    });
    expect(errors).toEqual([
      'extra is not a known top-level field',
      'exceptions[0].reason is required (non-empty string)',
      'exceptions[1].followUp is required (non-empty string)',
      'exceptions[2].screen "reports" is not one of login, home, partner-list, sales-invoice-new, settings, me, workforce, analytics',
      'exceptions[3].locales must be a non-empty list of ja / en',
      'exceptions[4].widths must be a non-empty list of 1280 / 390',
      'exceptions[5].until is not a known field',
      'exceptions[7] duplicates rule/screen/target color-contrast .eyebrow',
      'exceptions[8] must be an object',
    ]);
    expect(parseExceptions([]).errors).toEqual(['the file must be an object with an "exceptions" array']);
  });

  it('AC-3: the checked-in apps/web/e2e/a11y-exceptions.json is well-formed', () => {
    const raw: unknown = JSON.parse(readFileSync(new URL('../e2e/a11y-exceptions.json', import.meta.url), 'utf8'));
    expect(parseExceptions(raw).errors).toEqual([]);
  });
});
