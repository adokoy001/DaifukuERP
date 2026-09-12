import { describe, expect, it } from 'vitest';
import { commerceCopy } from './commerce-copy.ts';
describe('commerce business wording', () => {
 it('keeps Japanese as entered and translates business states without changing arbitrary evidence', () => { expect(commerceCopy('確認が必要', 'ja')).toBe('確認が必要'); expect(commerceCopy('確認が必要', 'en')).toBe('Review required'); expect(commerceCopy('精算状態', 'en')).toBe('Settlement status'); expect(commerceCopy('承認済み資料CUSTOM-123', 'en')).toBe('承認済み資料CUSTOM-123'); });
 it('preserves separators around translated dynamic labels', () => { expect(commerceCopy(' 連結コード', 'en')).toBe(' Group code'); expect(commerceCopy('借方 ', 'en')).toBe('Debit '); });
});
