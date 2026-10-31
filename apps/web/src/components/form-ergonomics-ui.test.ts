// docs/specs/form-ergonomics.md AC-2/AC-3/AC-4/AC-10, rendered statically (no browser): labelled sections as fieldsets
// with a legend, tabs marked with error counts, the error summary as the one alert with links, helper text and
// required marks wired to the input, and the shortcut list.
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FieldMeta } from '../api/types.ts';
import { LocaleProvider } from '../i18n.tsx';
import { FieldWidget } from './fields/field-widget.tsx';
import { FormErrorSummary } from './form-error-summary.tsx';
import { HeaderSections, sectionTitle, type HeaderSection } from './form-sections.tsx';
import { shortcutRows } from './form-shortcuts-help.tsx';

const render = (element: ReactElement) => renderToStaticMarkup(h(LocaleProvider, null, element));
const field = (name: string, extra: Partial<FieldMeta> = {}): FieldMeta => ({
  name,
  kind: 'text',
  label: { ja: `${name}名`, en: name },
  required: false,
  hasDefault: false,
  hidden: false,
  immutable: false,
  ...extra,
});
const sections: HeaderSection[] = [
  { key: 'g0', label: { ja: '基本', en: 'Basics' }, fields: [field('code'), field('name')] },
  { key: 'g1', fields: [field('phone')] },
  { key: 'g2', label: { ja: '口座', en: 'Bank' }, fields: [field('bankName')] },
  { key: 'g3', label: { ja: '備考', en: 'Notes' }, fields: [field('notes')] },
  { key: 'ext', label: { ja: '追加項目', en: 'Additional fields' }, fields: [field('ext.rank')] },
];
const props = {
  sections,
  selected: 'g2',
  onSelect: () => {},
  errorCounts: { g2: 2 },
  renderField: (f: FieldMeta) => h('input', { key: f.name, id: `f-${f.name}` }),
  idPrefix: 'form-partner',
};

describe('form-ergonomics AC-2: sections', () => {
  it('AC-2: stacked, a labelled group is a fieldset whose first child is its legend; plain groups stay untitled', () => {
    const html = render(h(HeaderSections, { ...props, layout: 'stack' }));
    expect(html).toMatch(
      /<fieldset class="ui-form-section record-section[^"]*"><legend class="ui-section-title">基本<\/legend>/,
    );
    expect(html).toContain('<legend class="ui-section-title">口座</legend>');
    expect(html).toMatch(/<fieldset class="[^"]*" data-section="g1"><input id="f-phone"/);
    expect(html).toContain('data-testid="ext-fields"');
    expect(html).not.toContain('role="tablist"');
  });

  it('AC-2: as tabs, one tab per section (untitled ones are "その他"), errors counted on the tab, one panel shown', () => {
    const html = render(h(HeaderSections, { ...props, layout: 'tabs' }));
    expect(html).toContain('role="tablist" aria-label="入力項目の区分"');
    expect(html.match(/role="tab"/g)).toHaveLength(5);
    expect(html).toContain('その他');
    expect(html).toMatch(
      /aria-selected="true"[^>]*>口座<span class="ui-badge ui-badge-danger ml-1" aria-hidden="true">2<\/span><span class="sr-only">（エラー 2 件）<\/span>/,
    );
    expect(html).toContain('<input id="f-bankName"/>');
    expect(html).not.toContain('id="f-code"');
    expect(sectionTitle({ key: 'rest', fields: [] }, 1, 2)).toEqual({ ja: 'その他 2', en: 'More 2' });
  });
});

describe('form-ergonomics AC-3: error summary', () => {
  const items = [
    { key: 'form:0', message: '配分合計が金額を超えています' },
    { key: 'field:name', message: '必須項目です', targetId: 'f-name', field: { ja: '名称', en: 'Name' } },
    {
      key: 'line',
      message: '必須項目です',
      targetId: 'l-sales_invoice_line-r1-description',
      field: { ja: '品名', en: 'Description' },
      line: { label: { ja: '売上明細', en: 'Invoice line' }, row: 2 },
    },
  ];

  it('AC-3: the count, a link per input and plain text for messages without one; one alert sentence per attempt', () => {
    const html = render(h(FormErrorSummary, { onJump: () => {}, attempt: 2, items }));
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    // The alert is the attempt's sentence (with the messages focus cannot carry), not the shrinking list.
    expect(html).toMatch(
      /<p role="alert" class="sr-only" data-testid="error-summary-alert" data-attempt="2">保存できませんでした。入力内容の問題が 3 件ありました。配分合計が金額を超えています<\/p>/,
    );
    expect(html).toContain('<h2 class="text-sm font-semibold">入力内容に 3 件の問題があります</h2>');
    expect(html).not.toMatch(/<div[^>]*role="alert"[^>]*data-testid="error-summary"/);
    expect(html).toContain('<span>配分合計が金額を超えています</span>');
    expect(html).toContain('href="#f-name"');
    expect(html).toContain('名称: 必須項目です');
    expect(html).toContain('href="#l-sales_invoice_line-r1-description"');
    expect(html).toContain('売上明細 2 行目の品名: 必須項目です');
    expect(render(h(FormErrorSummary, { onJump: () => {}, attempt: 1, items: [] }))).toBe('');
  });
});

describe('form-ergonomics AC-4: required marks and helper text', () => {
  const describe_ = { ja: '例: 03-1234-5678', en: 'e.g. 03-1234-5678' };
  it('AC-4: a required field without a default is marked, required, and described by its helper text and error', () => {
    const html = render(
      h(FieldWidget, {
        field: field('phone', { required: true, description: describe_ }),
        value: '',
        onChange: () => {},
        disabled: false,
        error: '必須項目です',
        alertError: false,
      }),
    );
    expect(html).toContain('aria-hidden="true">*</span>');
    expect(html).toMatch(/<input id="f-phone"[^>]* required=""[^>]*aria-describedby="f-phone-error f-phone-desc"/);
    expect(html).toContain('<span id="f-phone-error" data-testid="error-phone"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('<span id="f-phone-desc" class="field-description');
  });

  it('AC-4: no mark and no `required` for a defaulted or disabled field; the error is an alert outside the record form', () => {
    const defaulted = render(
      h(FieldWidget, {
        field: field('code', { required: true, hasDefault: true }),
        value: '',
        onChange: () => {},
        disabled: false,
        error: 'x',
      }),
    );
    expect(defaulted).not.toContain('>*</span>');
    expect(defaulted).not.toContain('required=""');
    expect(defaulted).toContain('role="alert"');
    const disabled = render(
      h(FieldWidget, {
        field: field('name', { required: true }),
        value: '',
        onChange: () => {},
        disabled: true,
        error: undefined,
      }),
    );
    expect(disabled).not.toContain('>*</span>');
    expect(disabled).not.toContain('aria-describedby');
  });
});

describe('form-ergonomics AC-10: shortcut list', () => {
  it('AC-10: save, advance, the grid keys and the palette, in the platform notation, ja and en', () => {
    const pc = shortcutRows(false);
    expect(pc.map((r) => r.keys)).toEqual(['Ctrl+S', 'Ctrl+Enter', 'Enter', 'Alt+↑ / Alt+↓', 'Ctrl+K']);
    // macOS names the Alt key Option (⌥), like ⌘ for Ctrl.
    expect(shortcutRows(true).map((r) => r.keys)).toEqual(['⌘S', '⌘↩', 'Enter', '⌥↑ / ⌥↓', '⌘K']);
    for (const row of pc) {
      expect(row.label.ja).not.toBe('');
      expect(row.label.en).not.toBe('');
    }
  });
});
