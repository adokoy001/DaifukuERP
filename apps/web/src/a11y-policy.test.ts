// e2e-a11y (docs/specs/e2e-a11y.md): the screen matrix and the exception rules that apps/web/e2e/a11y.spec.ts applies
// to axe results, and the checked-in exception file. The browser run itself is the Playwright spec.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  A11Y_SCREENS,
  WCAG_TAGS,
  a11yRuns,
  a11yTitle,
  expiredDeadlines,
  formatJudgement,
  isIsoDate,
  isSmokeRun,
  judge,
  parseExceptions,
  targetOf,
  type A11yException,
  type A11yRun,
  type AxeViolation,
} from '../e2e/a11y-policy.ts';

const RUN: A11yRun = { screen: 'home', locale: 'ja', width: 1280 };
const repoRoot = new URL('../../../', import.meta.url);
const documentExists = (path: string) => existsSync(new URL(path, repoRoot));
const violation = (id: string, impact: string | null, ...targets: string[]): AxeViolation => ({
  id,
  impact,
  help: `${id} help`,
  helpUrl: `https://dequeuniversity.com/rules/axe/4.13/${id}`,
  nodes: targets.map((target) => ({
    target: [target],
    html: `<span class="${target}">x</span>`,
    failureSummary: `Fix any of the following:\n  ${id} on ${target}`,
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
    expect(report).toContain('Fix any of the following:\n      color-contrast on .eyebrow');
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

  it('AC-2: axe needs-review (incomplete) nodes are counted per rule in the report and never fail', () => {
    const targets = Array.from({ length: 7 }, (_, index) => `.nav-${index}`);
    const result = judge([], [], RUN, [
      violation('color-contrast', 'serious', ...targets),
      violation('aria-prohibited-attr', 'serious', '.analytics-paging'),
    ]);
    expect(result.failures).toHaveLength(0);
    expect(result.needsReview).toHaveLength(8);
    const report = formatJudgement(RUN, result);
    expect(report).toContain('needs review: axe could not judge these nodes (not failing) (8):');
    expect(report).toContain('  - color-contrast [serious] 7 nodes: .nav-0, .nav-1, .nav-2, .nav-3, .nav-4, +2 more');
    expect(report).toContain('  - aria-prohibited-attr [serious] 1 nodes: .analytics-paging');
    expect(formatJudgement(RUN, judge([], [], RUN))).not.toContain('needs review');
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
      'exceptions[7] overlaps exceptions[6] for color-contrast home .eyebrow at ja/1280, ja/390, en/1280, en/390',
      'exceptions[8] must be an object',
    ]);
    expect(parseExceptions([]).errors).toEqual(['the file must be an object with an "exceptions" array']);
  });

  it('AC-3: entries for one rule/screen/target may split the conditions but not share one', () => {
    // A finding seen only at ja/1280 and en/390 needs two narrowed entries (one entry would be stale at ja/390, en/1280).
    const disjoint = parseExceptions({
      exceptions: [exception({ locales: ['ja'], widths: [1280] }), exception({ locales: ['en'], widths: [390] })],
    });
    expect(disjoint.errors).toEqual([]);
    expect(disjoint.exceptions).toHaveLength(2);
    const found = [violation('color-contrast', 'serious', '.eyebrow')];
    for (const run of [RUN, { ...RUN, locale: 'en' as const, width: 390 as const }]) {
      const result = judge(found, disjoint.exceptions, run);
      expect([result.failures.length, result.stale.length, result.waived.length]).toEqual([0, 0, 1]);
    }
    expect(judge([], disjoint.exceptions, { ...RUN, width: 390 }).stale).toEqual([]);
    expect(
      parseExceptions({ exceptions: [exception({ locales: ['ja'] }), exception({ widths: [390] })] }).errors,
    ).toEqual(['exceptions[1] overlaps exceptions[0] for color-contrast home .eyebrow at ja/390']);
    // Another target, rule or screen is a different key.
    expect(
      parseExceptions({ exceptions: [exception(), exception({ target: '.other' }), exception({ screen: 'me' })] })
        .errors,
    ).toEqual([]);
  });

  it('AC-3: followUp is a real YYYY-MM-DD deadline or an existing docs/ document (optionally with #anchor)', () => {
    const errorsOf = (followUp: string) =>
      parseExceptions({ exceptions: [exception({ followUp })] }, { documentExists }).errors;
    expect(errorsOf('2027-03-31')).toEqual([]);
    expect(errorsOf('docs/specs/ui-kit.md')).toEqual([]);
    expect(errorsOf('docs/specs/test-tiers.md#受入基準ears')).toEqual([]);
    expect(errorsOf('x')).toEqual([
      'exceptions[0].followUp "x" must be a deadline YYYY-MM-DD or a docs/....md path (optional #anchor)',
    ]);
    expect(errorsOf('2027-02-30')).toHaveLength(1);
    expect(errorsOf('2027/03/31')).toHaveLength(1);
    expect(errorsOf('docs/../package.json')).toHaveLength(1);
    expect(errorsOf('docs/specs/no-such-spec.md')).toEqual([
      'exceptions[0].followUp docs/specs/no-such-spec.md does not exist',
    ]);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2027-02-29')).toBe(false);
  });

  it('AC-3: a deadline before today is listed as expired (the a11y spec warns; a document follow-up never expires)', () => {
    const past = exception({ followUp: '2026-01-31' });
    const exceptions = [past, exception({ followUp: '2026-10-30' }), exception()];
    expect(expiredDeadlines(exceptions, '2026-10-30')).toEqual([past]);
    expect(expiredDeadlines(exceptions, '2026-01-31')).toEqual([]);
  });

  it('AC-3: the checked-in apps/web/e2e/a11y-exceptions.json is well-formed and its documents exist', () => {
    const raw: unknown = JSON.parse(readFileSync(new URL('../e2e/a11y-exceptions.json', import.meta.url), 'utf8'));
    expect(parseExceptions(raw, { documentExists }).errors).toEqual([]);
  });
});
