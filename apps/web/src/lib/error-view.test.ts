// ui-kit AC-8/AC-9: errors are presented human-first; code, HTTP status and hint are kept as secondary information.
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client.ts';
import { describeError, errorExplanation, toastFromError } from './error-view.ts';

const conflict = new ApiError(409, {
  code: 'CONFLICT',
  message: '他の利用者が更新しました',
  hint: 'Reload and retry.',
});

describe('ui-kit AC-8: describeError', () => {
  it('AC-8: keeps the server message and adds a localized explanation, code, status and hint', () => {
    expect(describeError(conflict)).toEqual({
      message: '他の利用者が更新しました',
      explanation: errorExplanation('CONFLICT', 409),
      code: 'CONFLICT',
      status: 409,
      hint: 'Reload and retry.',
    });
    expect(errorExplanation('CONFLICT', 409)?.ja).toContain('競合');
  });

  it('AC-8: a request that never reached the API is explained as a connection problem', () => {
    const offline = new ApiError(0, { code: 'INTERNAL', message: 'Failed to fetch', hint: 'Cannot reach the API' });
    expect(describeError(offline).explanation).toEqual(errorExplanation(undefined, 0));
    expect(describeError(offline).explanation?.en).toContain('Could not reach the server');
  });

  it('AC-8: every API error code has a Japanese and English explanation', () => {
    for (const code of [
      'VALIDATION',
      'PERMISSION_DENIED',
      'NOT_FOUND',
      'CONFLICT',
      'INVALID_STATE',
      'HAS_DEPENDENTS',
      'INTERNAL',
    ]) {
      const label = errorExplanation(code, 400);
      expect(label?.ja, code).toBeTruthy();
      expect(label?.en, code).toBeTruthy();
    }
    expect(errorExplanation('SOMETHING_NEW', 400)).toBeUndefined();
  });

  it('AC-8: plain errors and thrown values keep their text without inventing a code', () => {
    expect(describeError(new Error('boom'))).toEqual({ message: 'boom' });
    expect(describeError('raw')).toEqual({ message: 'raw' });
  });

  it('AC-8: an API error without message falls back to its code; an empty hint is omitted', () => {
    const view = describeError(new ApiError(500, { code: 'INTERNAL', message: '', hint: '' }));
    expect(view.message).toBe('INTERNAL');
    expect('hint' in view).toBe(false);
  });
});

describe('ui-kit AC-9: toastFromError', () => {
  it('AC-9: human message as title, hint next, code as secondary text (nothing dropped)', () => {
    expect(toastFromError(conflict, 'Error')).toEqual({
      kind: 'error',
      title: '他の利用者が更新しました',
      message: 'Reload and retry.',
      code: 'CONFLICT',
    });
  });

  it('AC-9: non-API errors use the fallback title and keep the error text', () => {
    expect(toastFromError(new Error('network down'), '保存できませんでした')).toEqual({
      kind: 'error',
      title: '保存できませんでした',
      message: 'network down',
    });
  });
});
