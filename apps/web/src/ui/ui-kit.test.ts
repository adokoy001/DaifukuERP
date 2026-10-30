// ui-kit: markup and semantics of the UI kit, rendered with react-dom/server (no DOM library; docs/specs/ui-kit.md).
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ariaSortFor,
  Badge,
  Button,
  buttonClass,
  Card,
  cellAlignClass,
  DataTableShell,
  Dialog,
  EmptyState,
  FormSection,
  nextTabIndex,
  PageHeader,
  scrollToShow,
  Skeleton,
  SkeletonCard,
  SkeletonRows,
  TabPanel,
  Tabs,
  Toolbar,
  type BadgeProps,
  type ButtonProps,
  type TabItem,
} from './index.ts';

const html = (element: ReactElement) => renderToStaticMarkup(element);
const noop = () => undefined;

describe('ui-kit AC-1: exported building blocks', () => {
  it('AC-1: every component named by the spec is exported from ui/index.ts', () => {
    for (const component of [
      PageHeader,
      Toolbar,
      Card,
      EmptyState,
      Skeleton,
      SkeletonRows,
      SkeletonCard,
      Button,
      Badge,
      Tabs,
      TabPanel,
      Dialog,
      FormSection,
      DataTableShell,
    ])
      expect(typeof component).toBe('function');
  });

  it('AC-1: PageHeader renders one h1 with its test id, meta, subtitle and actions', () => {
    const markup = html(
      h(PageHeader, {
        title: '取引先',
        titleTestId: 'record-title',
        meta: h('span', null, 'partner'),
        subtitle: '説明',
        actions: h('a', { href: '/e/partner/new' }, '+ 新規'),
        back: h('a', { href: '/e/partner' }, '← 取引先'),
      }),
    );
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain('<h1 data-testid="record-title">取引先</h1>');
    expect(markup).toContain('class="ui-page-header-subtitle">説明</p>');
    expect(markup).toContain('class="ui-page-header-actions"><a href="/e/partner/new">+ 新規</a>');
    expect(markup.indexOf('← 取引先')).toBeLessThan(markup.indexOf('<h1'));
  });

  it('AC-1: PageHeader keeps the icon and the text block in one non-wrapping group; only the actions wrap', () => {
    const markup = html(
      h(PageHeader, {
        title: '見出し',
        icon: h('span', { className: 'icon-tile' }, 'i'),
        actions: h('button', null, '操作'),
      }),
    );
    expect(markup).toMatch(
      /^<header class="ui-page-header"><div class="ui-page-header-main"><span class="icon-tile">i<\/span><div class="ui-page-header-text">/,
    );
    expect(markup).toContain('</div></div><div class="ui-page-header-actions"><button>操作</button></div></header>');
  });

  it('AC-1: Toolbar is a plain row, exposed as a named group only when labelled', () => {
    expect(html(h(Toolbar, { end: 'pager' }, 'search'))).toBe(
      '<div class="ui-toolbar">search<div class="ui-toolbar-end">pager</div></div>',
    );
    expect(html(h(Toolbar, { label: '絞り込み' }, 'x'))).toContain('role="group" aria-label="絞り込み"');
  });

  it('AC-1: Card can be the form itself and passes form attributes through', () => {
    const markup = html(h(Card, { as: 'form', noValidate: true, 'aria-label': '設定' }, 'body'));
    // HTML attribute names are case-insensitive; React's server output spells it noValidate.
    expect(markup).toMatch(/^<form novalidate="" aria-label="設定" class="ui-card">body<\/form>$/i);
    expect(html(h(Card, null, 'x'))).toBe('<section class="ui-card">x</section>');
    // Form-only attributes are a type error on a non-form card (checked by `pnpm typecheck`).
    // @ts-expect-error noValidate belongs to <form>
    expect(html(h(Card, { as: 'section', noValidate: true }, 'x'))).toContain('class="ui-card"');
  });

  it('AC-1: FormSection is a group labelled by its heading by default, not a landmark', () => {
    const group = html(h(FormSection, { title: '税込入力', description: '説明', meta: 'tax.price' }, 'fields'));
    const id = /<h2 id="([^"]+)"/.exec(group)?.[1];
    expect(id).toBeTruthy();
    expect(group).toContain(`<div role="group" class="ui-form-section" aria-labelledby="${id}">`);
    expect(group).not.toContain('<section');
    expect(group).toContain('<p class="ui-section-description">説明</p>fields');
  });

  it('AC-1: FormSection is a named region only on request, and a fieldset names itself with a first-child legend', () => {
    const region = html(h(FormSection, { title: '会社', landmark: true }, 'x'));
    const id = /<h2 id="([^"]+)"/.exec(region)?.[1];
    expect(region).toMatch(new RegExp(`^<section class="ui-form-section" aria-labelledby="${id}">`));
    const fieldset = html(
      h(FormSection, { title: '基本', as: 'fieldset', meta: 'basic', actions: h('button', null, 'JSON') }, 'x'),
    );
    expect(fieldset).toMatch(/^<fieldset class="ui-form-section"><legend class="ui-section-title">基本<\/legend>/);
    expect(fieldset).not.toContain('aria-labelledby');
    expect(fieldset).toContain(
      '<div class="ui-section-head">basic<div class="ui-section-actions"><button>JSON</button>',
    );
  });

  it('AC-1: Badge colours by semantic tone and passes data attributes', () => {
    // JSX passes data-* through; createElement needs the props widened explicitly.
    const props = { tone: 'success', 'data-testid': 'docstatus', 'data-docstatus': 1 } as BadgeProps;
    const markup = html(h(Badge, props, '確定'));
    expect(markup).toBe(
      '<span class="ui-badge ui-badge-success" data-testid="docstatus" data-docstatus="1">確定</span>',
    );
  });
});

describe('ui-kit AC-4/AC-6/AC-7: empty and loading states', () => {
  it('AC-4: EmptyState shows the message, description and the primary action, without a live region', () => {
    const markup = html(
      h(EmptyState, {
        title: 'まだ記録がありません',
        description: '最初の記録を登録すると、ここに一覧で表示されます。',
        action: h('a', { href: '/e/partner/new' }, '取引先を登録する'),
      }),
    );
    expect(markup).toContain('data-testid="empty-state"');
    expect(markup).toContain('<p class="ui-empty-title">まだ記録がありません</p>');
    expect(markup).toContain('<div class="ui-empty-actions"><a href="/e/partner/new">取引先を登録する</a></div>');
    expect(markup).not.toMatch(/role="(alert|status)"|aria-live/);
    expect(html(h(EmptyState, { title: 'x', titleAs: 'h2' }))).toContain('<h2 class="ui-empty-title">x</h2>');
    expect(html(h(EmptyState, { title: 'x', titleAs: 'h1' }))).toContain('<h1 class="ui-empty-title">x</h1>');
  });

  it('AC-6/AC-7: skeleton placeholders are hidden from assistive technology', () => {
    expect(html(h(Skeleton, { width: '40%' }))).toBe(
      '<span aria-hidden="true" class="ui-skeleton" style="width:40%"></span>',
    );
    const rows = html(h('table', null, h('tbody', null, h(SkeletonRows, { rows: 2, columns: 3 }))));
    expect(rows.match(/<tr aria-hidden="true" data-testid="skeleton-row">/g)).toHaveLength(2);
    expect(rows.match(/<td>/g)).toHaveLength(6);
    expect(html(h(SkeletonCard, { lines: 2 }))).toMatch(/^<div class="ui-skeleton-card" aria-hidden="true">/);
  });
});

describe('ui-kit AC-14: DataTableShell', () => {
  const head = h(
    'tr',
    null,
    h('th', { scope: 'col' }, '名称'),
    h('th', { scope: 'col', className: 'ui-cell-num' }, '金額'),
  );
  const row = h('tr', { 'data-testid': 'row' }, h('td', null, 'A'), h('td', { className: 'ui-cell-num' }, '1'));

  it('AC-14: renders rows inside a labelled table frame, not busy', () => {
    const markup = html(h(DataTableShell, { head, columnCount: 2, label: '取引先' }, row));
    expect(markup).toMatch(
      /^<div class="ui-table-frame" aria-busy="false"><table class="ui-table" aria-label="取引先">/,
    );
    expect(markup).toContain('<tbody><tr data-testid="row">');
    expect(cellAlignClass('right')).toBe('ui-cell-num');
    expect(cellAlignClass('left')).toBeUndefined();
  });

  it('AC-6/AC-14: skeleton replaces the rows and marks the frame busy', () => {
    const markup = html(h(DataTableShell, { head, columnCount: 2, busy: true, skeleton: true, skeletonRows: 3 }, row));
    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain('data-testid="row"');
    expect(markup.match(/data-testid="skeleton-row"/g)).toHaveLength(3);
    expect(markup).not.toContain('is-refreshing');
  });

  it('AC-6: the loading text is a polite live region outside the busy frame, filled only while skeleton rows show', () => {
    const loading = html(
      h(DataTableShell, { head, columnCount: 2, busy: true, skeleton: true, loadingLabel: '読み込み中…' }, row),
    );
    expect(loading).toMatch(
      /^<p class="sr-only" aria-live="polite">読み込み中…<\/p><div class="ui-table-frame" aria-busy="true">/,
    );
    const loaded = html(h(DataTableShell, { head, columnCount: 2, loadingLabel: '読み込み中…' }, row));
    expect(loaded).toMatch(
      /^<p class="sr-only" aria-live="polite"><\/p><div class="ui-table-frame" aria-busy="false">/,
    );
    expect(loaded).not.toMatch(/role="(status|alert)"/);
  });

  it('AC-6: a background refetch keeps the rows and shows the refreshing bar', () => {
    const markup = html(h(DataTableShell, { head, columnCount: 2, busy: true }, row));
    expect(markup).toContain('class="ui-table-frame is-refreshing" aria-busy="true"');
    expect(markup).toContain('data-testid="row"');
  });

  it('AC-4/AC-14: the empty state follows the table inside the frame, so it is as wide as the visible frame', () => {
    const markup = html(
      h(DataTableShell, { head, columnCount: 2, isEmpty: true, empty: h(EmptyState, { title: 'なし' }), fill: true }),
    );
    expect(markup).toContain('class="ui-table-frame is-fill"');
    expect(markup).toContain(
      '<tbody></tbody></table><div class="ui-table-empty"><div class="ui-empty" data-testid="empty-state">',
    );
    expect(markup).not.toContain('colSpan');
  });

  it('AC-14: only the sorted column header carries aria-sort', () => {
    expect(ariaSortFor('asc')).toBe('ascending');
    expect(ariaSortFor('desc')).toBe('descending');
    expect(ariaSortFor(false)).toBeUndefined();
  });
});

describe('ui-kit AC-13: Button', () => {
  it('AC-13: variants map onto the existing .btn classes and default to type=button', () => {
    expect(buttonClass('primary')).toBe('btn btn-primary');
    expect(buttonClass()).toBe('btn');
    expect(buttonClass('danger')).toBe('btn btn-danger');
    expect(buttonClass('ghost', 'sm', 'extra')).toBe('btn btn-ghost btn-sm extra');
    expect(html(h(Button, null, '戻る'))).toBe('<button type="button" class="btn">戻る</button>');
    expect(html(h(Button, { type: 'submit', variant: 'primary', disabled: true }, '保存'))).toBe(
      '<button type="submit" class="btn btn-primary" disabled="">保存</button>',
    );
  });
});

describe('ui-kit AC-11: Tabs', () => {
  const items: TabItem[] = [
    { id: 'basic', label: '基本' },
    { id: 'tax', label: '税', disabled: true },
    { id: 'bank', label: '銀行' },
  ];

  it('AC-11: tablist / tab / tabpanel semantics with a roving tabindex', () => {
    const markup = html(
      h(Tabs, { items, selected: 'bank', onSelect: noop, label: '設定の分類', idPrefix: 'settings' }),
    );
    expect(markup).toContain('<div role="tablist" aria-label="設定の分類" class="ui-tabs">');
    expect(markup).toContain(
      '<button type="button" role="tab" id="settings-tab-bank" aria-selected="true" aria-controls="settings-panel-bank" tabindex="0" class="ui-tab">銀行</button>',
    );
    expect(markup).toContain(
      'id="settings-tab-basic" aria-selected="false" aria-controls="settings-panel-basic" tabindex="-1"',
    );
    expect(markup).toMatch(/id="settings-tab-tax" aria-selected="false"[^>]*tabindex="-1" disabled=""/);
    const panel = html(h(TabPanel, { idPrefix: 'settings', id: 'bank', selected: true }, 'content'));
    expect(panel).toBe(
      '<div role="tabpanel" id="settings-panel-bank" aria-labelledby="settings-tab-bank" tabindex="0" class="ui-tab-panel">content</div>',
    );
    expect(html(h(TabPanel, { idPrefix: 'settings', id: 'basic', selected: false }, 'hidden'))).toContain('hidden=""');
  });

  it('AC-11: an invalid selection still leaves exactly one tab in the Tab order', () => {
    const markup = html(h(Tabs, { items, selected: 'missing', onSelect: noop, label: 'x', idPrefix: 'p' }));
    expect(markup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(markup).toContain('id="p-tab-basic" aria-selected="false" aria-controls="p-panel-basic" tabindex="0"');
  });

  it('AC-11: arrow keys wrap and skip disabled tabs; Home/End go to the ends; other keys do nothing', () => {
    expect(nextTabIndex(items, 0, 'ArrowRight')).toBe(2);
    expect(nextTabIndex(items, 2, 'ArrowRight')).toBe(0);
    expect(nextTabIndex(items, 0, 'ArrowLeft')).toBe(2);
    expect(nextTabIndex(items, 2, 'ArrowLeft')).toBe(0);
    expect(nextTabIndex(items, 2, 'Home')).toBe(0);
    expect(nextTabIndex(items, 0, 'End')).toBe(2);
    expect(nextTabIndex(items, 0, 'Enter')).toBeUndefined();
    expect(nextTabIndex([{ id: 'a', label: 'a', disabled: true }], 0, 'ArrowRight')).toBeUndefined();
  });

  it('settings-console AC-14: a tab list that scrolls brings the selected tab into view (left edge first)', () => {
    const list = { left: 16, right: 374 };
    expect(scrollToShow(list, { left: 100, right: 160 })).toBe(0);
    expect(scrollToShow(list, { left: 420, right: 480 })).toBe(106);
    expect(scrollToShow(list, { left: -50, right: 10 })).toBe(-66);
    // A tab wider than the list keeps its start visible.
    expect(scrollToShow(list, { left: 300, right: 800 })).toBe(284);
  });
});

describe('ui-kit AC-12: Dialog', () => {
  it('AC-12: native dialog labelled by its title, with a named close button, form content and actions', () => {
    const markup = html(
      h(
        Dialog,
        {
          title: '確定',
          description: '確定すると編集できません。',
          closeLabel: '閉じる',
          onClose: noop,
          onSubmit: noop,
          actions: h(Button, { 'data-autofocus': true } as ButtonProps, '戻る'),
        },
        h('p', null, 'body'),
      ),
    );
    const id = /<h2 id="([^"]+)">確定<\/h2>/.exec(markup)?.[1];
    const descriptionId = /<p id="([^"]+)">確定すると編集できません。<\/p>/.exec(markup)?.[1];
    expect(id).toBeTruthy();
    expect(descriptionId).toBeTruthy();
    expect(markup).toMatch(
      new RegExp(`^<dialog class="action-dialog" aria-labelledby="${id}" aria-describedby="${descriptionId}"><form>`),
    );
    expect(markup).toContain('<button type="button" aria-label="閉じる">');
    expect(markup).toContain('確定すると編集できません。</p><p>body</p><div class="dialog-actions">');
    expect(markup).toContain('<button type="button" class="btn" data-autofocus="true">戻る</button>');
    expect(markup).not.toContain(' open=');
  });

  it('AC-12: without a description the dialog has no aria-describedby', () => {
    const markup = html(h(Dialog, { title: '確認', closeLabel: '閉じる', onClose: noop }));
    expect(markup).toMatch(/^<dialog class="action-dialog" aria-labelledby="[^"]+"><div>/);
    expect(markup).not.toContain('aria-describedby');
  });
});
