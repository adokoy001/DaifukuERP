import { afterEach, expect, it, vi } from 'vitest';
import { showHtmlIn } from './download.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('AC-2: severs the print tab opener before navigation and retains its object URL for the print dialog', async () => {
  vi.useFakeTimers();
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-print');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const tab = {
    opener: {} as object | null,
    location: { replace: vi.fn(() => expect(tab.opener).toBeNull()) },
  };
  showHtmlIn(tab as unknown as Window, '<h1>Synthetic invoice</h1>');
  expect(tab.location.replace).toHaveBeenCalledWith('blob:synthetic-print');
  const blob = create.mock.calls[0]?.[0];
  expect(blob).toBeInstanceOf(Blob);
  if (!(blob instanceof Blob)) throw new Error('Expected print blob');
  expect(await blob.text()).toBe('<h1>Synthetic invoice</h1>');
  expect(blob.type).toBe('text/html;charset=utf-8');
  expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(10 * 60_000);
  expect(revoke).toHaveBeenCalledWith('blob:synthetic-print');
});
