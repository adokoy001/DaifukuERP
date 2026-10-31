// docs/specs/inbox.md AC-1: the shared `<module>.todo` output contract (kernel/src/todo-result.ts).
import { describe, expect, it } from 'vitest';
import { label, todoInput, todoItems, todoResult } from '../src/index.ts';

const item = (count: number, href = '/workforce') => ({
  key: 'expense_review',
  label: label('承認待ちの経費', 'Expenses awaiting approval'),
  count,
  href,
  severity: 'info' as const,
});

describe('todo provider contract (inbox AC-1)', () => {
  it('AC-1: todoItems drops zero and skipped counts and keeps the given order', () => {
    expect(todoItems([item(0), null, item(2), undefined, { ...item(1), key: 'leave_review' }])).toEqual({
      items: [item(2), { ...item(1), key: 'leave_review' }],
    });
  });

  it('AC-1: input is the empty object only', () => {
    expect(todoInput.safeParse({}).success).toBe(true);
    expect(todoInput.safeParse({ period: '2026-09' }).success).toBe(false);
  });

  it('AC-1: output requires a positive integer count, a snake_case key, both label languages and info/warn', () => {
    expect(todoResult.safeParse({ items: [item(3)] }).success).toBe(true);
    for (const bad of [
      { ...item(0) },
      { ...item(1.5) },
      { ...item(1), key: 'Expense-Review' },
      { ...item(1), label: { ja: '経費', en: '' } },
      { ...item(1), severity: 'error' },
    ])
      expect(todoResult.safeParse({ items: [bad] }).success).toBe(false);
  });

  it('AC-6: href is an in-app path; external, protocol-relative and backslash forms are rejected', () => {
    for (const href of ['/workforce', '/workforce?period=2026-09', '/e/payment?sort=unallocatedAmount:desc'])
      expect(todoResult.safeParse({ items: [item(1, href)] }).success).toBe(true);
    for (const href of ['https://example.com/', '//example.com/x', '/\\example.com', 'workforce', '/a b', ''])
      expect(todoResult.safeParse({ items: [item(1, href)] }).success).toBe(false);
  });
});
